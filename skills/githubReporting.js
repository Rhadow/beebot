const fetch = require('node-fetch')
const moment = require('moment')
const PROTOCOL = 'https'
const API_HOST = 'api.github.com'
const BASE_URL = `${PROTOCOL}://${API_HOST}`
const ACCESS_TOKEN = process.env.GITHUB_ACCESS_TOKEN;
const REPO_OWNER = 'honestbee'
const REPO_NAME = 'HB-Consumer-Web'
const API_URL = `${BASE_URL}/repos/${REPO_OWNER}/${REPO_NAME}/events?access_token=${ACCESS_TOKEN}`
const TARGET_USERS = {
	ShinyChang: 'Shiny',
	Rhadow: 'Howard',
	kidwm: 'Chen-Heng',
	wangchou: 'Wang-Chou'
}
const UPDATE_INTERVAL = 2 * 60 * 1000 // 2 minutes


const fetchAllEvents = () => {
	const promises = []
	const today = new Date()
	const todayYMD = today.toISOString().split('T').shift()
	today.setDate(today.getDate() - 1)
	const yestdayYMD = today.toISOString().split('T').shift()
	for (let i = 1; i <= 5; i++) {
		promises.push(
			fetch(`${API_URL}&page=${i}`).then(res => res.json()).then(json => {
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

const issueCommentEventHandler = (evt) => {
	switch (evt.payload.action) {
		case 'created':
			if (evt.payload.issue.pull_request) {
				return {
					user: evt.actor,
					action: 'PR commented',
					message: `https://github.com/${REPO_OWNER}/${REPO_NAME}/pull/${evt.payload.issue.number}`,
					created_at: evt.created_at
				}
			} else {
				return {
					user: evt.actor,
					action: 'Issue commented',
					message: `https://github.com/${REPO_OWNER}/${REPO_NAME}/issues/${evt.payload.issue.number}`,
					created_at: evt.created_at
				}
			}
	}

}

const pullRequestEventHandler = (evt) => {
	switch (evt.payload.action) {
		case 'opened':
			return {
				user: evt.actor,
				action: 'PR created',
				message: `https://github.com/${REPO_OWNER}/${REPO_NAME}/pull/${evt.payload.number}`,
				created_at: evt.created_at
			}
		case 'closed':
			return {
				user: evt.actor,
				action: evt.payload.pull_request.merged ? 'PR merged' : 'PR closed',
				message: `https://github.com/${REPO_OWNER}/${REPO_NAME}/pull/${evt.payload.number}`,
				created_at: evt.created_at
			}
		default:
			console.log(evt)
	}
}

const pullRequestReviewCommentEventHandler = (evt) => {
	switch (evt.payload.action) {
		case 'created':
			return {
				user: evt.actor,
				action: 'PR reviewed',
				message: `https://github.com/${REPO_OWNER}/${REPO_NAME}/pull/${evt.payload.pull_request.number}`,
				created_at: evt.created_at
			}
		default:
			console.log(evt)
	}
}

const UpdateGithubEvent = () => {
	return fetchAllEvents().then(evts => {
		return evts.reduce((carry, current) => {
			return carry.concat(current)
		}, [])
	}).then(evts => {
		return evts.filter(evt => {
			return Object.keys(TARGET_USERS).includes(evt.actor)
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
					data = pullRequestEventHandler(evt)
					break
				case 'IssueCommentEvent':
					data = issueCommentEventHandler(evt)
					break
				case 'PullRequestReviewCommentEvent':
					data = pullRequestReviewCommentEventHandler(evt)
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
		console.log(`${yestdayYMD} daily report`)
		Object.keys(evts).forEach((key) => {
			result += `\n${TARGET_USERS[key]} (${evts[key].length})\n`;
			evts[key].forEach(evt => {
				const t = moment(evt.created_at).format('HH:mm');
				result += `[${t}] [${evt.action}] ${evt.message}\n`
			})
		})
		return result;
		console.log('last update ' + new Date())
	}).catch(err => {
		console.log(err)
	})
}

function reportGithubEvent(rtm, message, job) {
	const channel = message.channel;
	const text = message.text;
	const isMentioned = text && text.includes(`<@${rtm.activeUserId}>`);
	if (!isMentioned) {
		return;
	}
	if (text.includes('start github reporting')) {
		if (!job || typeof job !== 'object') {
			rtm.sendMessage('OK, starting reporting...', channel);
			job = setInterval(() => {
				UpdateGithubEvent().then(result => {
					rtm.sendMessage(`${result}`, channel);
				});
			}, UPDATE_INTERVAL);
		} else {
			rtm.sendMessage('Reporting is running already', channel);
		}
	}
	if (text.includes('stop github reporting')) {
		if (!job || typeof job !== 'object') {
			rtm.sendMessage('Github reporting is not running', channel);
		} else {
			clearInterval(job);
			job = null;
			rtm.sendMessage('Reporting stopped', channel);
		}
	}
	return job;
};

module.exports = reportGithubEvent;
