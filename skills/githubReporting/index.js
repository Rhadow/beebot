const CronJob = require('cron').CronJob;
const fetch = require('node-fetch');
const moment = require('moment');
const PROTOCOL = 'https';
const API_HOST = 'api.github.com';
const BASE_URL = `${PROTOCOL}://${API_HOST}`;
const {
	GITHUB_ACCESS_TOKEN,
	GITHUB_REPORT_TARGET_CHANNEL,
	REPO_OWNER,
} = process.env;
const {TEAMS} = require('./constants.js');
const SHOW_ALL_USERS = false;

const fetchAllEvents = (apiUrl) => {
	const promises = []
	const today = new Date()
	const todayYMD = today.toISOString().split('T').shift()
	today.setDate(today.getDate() - 1)
	const yestdayYMD = today.toISOString().split('T').shift()
	for (let i = 1; i <= 5; i++) {
		promises.push(
			fetch(`${apiUrl}&page=${i}`).then(res => res.json()).then(json => {
				return json.map(evt => {
					return {
						type: evt.type,
						actor: evt.actor.login,
						payload: evt.payload,
						created_at: evt.created_at
					}
				}).filter(evt => {
					return evt.created_at > `${yestdayYMD}T01:00:00Z` && evt.created_at <= `${todayYMD}T01:00:00Z`
				})
			})
		)
	}
	return Promise.all(promises)
}

const issueCommentEventHandler = (evt, repoName) => {
	switch (evt.payload.action) {
		case 'created':
			if (evt.payload.issue.pull_request) {
				return {
					user: evt.actor,
					action: 'PR commented',
					message: `https://github.com/${REPO_OWNER}/${repoName}/pull/${evt.payload.issue.number}`,
					created_at: evt.created_at
				}
			} else {
				return {
					user: evt.actor,
					action: 'Issue commented',
					message: `https://github.com/${REPO_OWNER}/${repoName}/issues/${evt.payload.issue.number}`,
					created_at: evt.created_at
				}
			}
	}

}

const pullRequestEventHandler = (evt, repoName) => {
	switch (evt.payload.action) {
		case 'opened':
			return {
				user: evt.actor,
				action: 'PR created',
				message: `https://github.com/${REPO_OWNER}/${repoName}/pull/${evt.payload.number}`,
				created_at: evt.created_at
			}
		case 'closed':
			return {
				user: evt.actor,
				action: evt.payload.pull_request.merged ? 'PR merged' : 'PR closed',
				message: `https://github.com/${REPO_OWNER}/${repoName}/pull/${evt.payload.number}`,
				created_at: evt.created_at
			}
		default:
			console.log(evt)
	}
}

const pullRequestReviewCommentEventHandler = (evt, repoName) => {
	switch (evt.payload.action) {
		case 'created':
			return {
				user: evt.actor,
				action: 'PR reviewed',
				message: `https://github.com/${REPO_OWNER}/${repoName}/pull/${evt.payload.pull_request.number}`,
				created_at: evt.created_at
			}
		default:
			console.log(evt)
	}
}

const UpdateGithubEvent = (targetUsers, repoName) => {
	const API_URL = `${BASE_URL}/repos/${REPO_OWNER}/${repoName}/events?access_token=${GITHUB_ACCESS_TOKEN}`
	return fetchAllEvents(API_URL).then(evts => {
		return evts.reduce((carry, current) => {
			return carry.concat(current)
		}, [])
	}).then(evts => {
		return evts.filter(evt => {
			return Object.keys(targetUsers).includes(evt.actor)
		}).map(evt => {
			let data
			switch (evt.type) {
				case 'CreateEvent':
				case 'DeleteEvent':
				case 'ForkEvent':
				case 'WatchEvent':
				case 'ReleaseEvent':
				case 'PushEvent':
					break
				case 'PullRequestEvent':
					data = pullRequestEventHandler(evt, repoName)
					break
				case 'IssueCommentEvent':
					data = issueCommentEventHandler(evt,repoName)
					break
				case 'PullRequestReviewCommentEvent':
					data = pullRequestReviewCommentEventHandler(evt, repoName)
					break
				default:
					console.log(evt)
					break
			}
			return data
		}).filter(o => o).reverse().reduce((user_evts, evt) => {
			if (!user_evts[evt.user]) {
				user_evts[evt.user] = []
			}
			user_evts[evt.user].push(evt)
			return user_evts
		}, {})
	}).then(evts => {
		let result = '';
		const today = new Date()
		today.setDate(today.getDate() - 1)
		const yestdayYMD = today.toISOString().split('T').shift()
		Object.keys(targetUsers).forEach(userId => {
			let userEvents = evts[userId] || [];
			if (SHOW_ALL_USERS || userEvents.length !== 0) {
				result += `\n${targetUsers[userId]} (${userEvents.length})\n`;
				userEvents.forEach(evt => {
					const t = moment(evt.created_at).format('HH:mm');
					result += `[${t}] [${evt.action}] ${evt.message}\n`
				});
			}
		});
		return result;
		console.log('last update ' + new Date())
	}).catch(err => {
		console.log(err)
	})
}

function reportGithubEvent(rtm, message, job) {
	const groups = rtm.dataStore.groups;
	const messageChannel = message.channel;
	const channelID = Object.keys(groups).reduce((result, id) => {
		return groups[id].name === GITHUB_REPORT_TARGET_CHANNEL ? id : result;
	}, '');
	const text = message.text;
	const isMentioned = text && text.includes(`<@${rtm.activeUserId}>`);
	if (!isMentioned || !channelID) {
		return;
	}
	if (text.includes('start github report')) {
		if (job && job.running) {
			rtm.sendMessage('Github reporting job is already running', messageChannel);
		} else {
			rtm.sendMessage(`Github reporting *started*, will report to channel *${GITHUB_REPORT_TARGET_CHANNEL}*`, messageChannel);
			job = new CronJob('00 30 9 * * 2-6', () => {
				const today = moment().format('YYYY-MM-DD');
				rtm.sendMessage(`*Github log for ${today}:*\n\n`, channelID);
				TEAMS.forEach(({TEAM_NAME, REPO_NAME, MEMBERS}) => {
					let teamResult = `\n*${TEAM_NAME}:*\n`;
					UpdateGithubEvent(MEMBERS, REPO_NAME).then(result => {
						rtm.sendMessage(`${teamResult}${result}`, channelID);
					});
				});
			}, null);
			job.start();
		}
	}
	if (text.includes('stop github report')) {
		if (job && job.running) {
			job.stop();
			rtm.sendMessage('Github reporting job *stopped*', messageChannel);
		} else {
			rtm.sendMessage('No github reporting job running', messageChannel);
		}
	}
	return job;
};

module.exports = reportGithubEvent;
