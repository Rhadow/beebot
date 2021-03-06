require('dotenv').config();
const {
  RtmClient,
  CLIENT_EVENTS,
  RTM_EVENTS
} = require('@slack/client');
const {githubReporting} = require('./skills');

const bot_token = process.env.SLACK_BOT_TOKEN || '';
const rtm = new RtmClient(bot_token);

// The client will emit an RTM.AUTHENTICATED event on successful connection, with the `rtm.start` payload if you want to cache it
rtm.on(CLIENT_EVENTS.RTM.AUTHENTICATED, (rtmStartData) => {
  console.log(`Logged in as ${rtmStartData.self.name} of team ${rtmStartData.team.name}, but not yet connected to a channel`);
});

rtm.start();

let githubReportJob = null;

rtm.on(RTM_EVENTS.MESSAGE, function(message) {
  githubReportJob = githubReporting(rtm, message, githubReportJob);
});
