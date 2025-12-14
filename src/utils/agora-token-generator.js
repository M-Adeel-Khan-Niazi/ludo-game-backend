const { RtcTokenBuilder, RtcRole } = require("agora-access-token");
const { AGORA_APP_ID, AGORA_APP_CERTIFICATE } = require("../config/env");

const APP_ID = AGORA_APP_ID;
const APP_CERTIFICATE = AGORA_APP_CERTIFICATE;

const generateAgoraToken = (channelName, uid = 0, expireTime = 3600) => {
  if (!APP_ID || !APP_CERTIFICATE) {
    throw new Error("Agora credentials not set");
  }

  const currentTime = Math.floor(Date.now() / 1000);
  const privilegeExpireTime = currentTime + expireTime;

  const token = RtcTokenBuilder.buildTokenWithUid(
    APP_ID,
    APP_CERTIFICATE,
    channelName,
    uid,
    RtcRole.PUBLISHER,
    privilegeExpireTime
  );

  return token;
};

module.exports = { generateAgoraToken };
