const SocialService = require("../services/social.service");

class SocialController {

    async getUserProfile(req, res) {
        await SocialService.getUserProfile(req, res);
    }

    async manageFriend(req, res) {
        await SocialService.manageFriend(req, res);
    }

    async getFriendList(req, res) {
        await SocialService.getFriendList(req, res);
    }

    async getFriendRequests(req, res) {
        await SocialService.getFriendRequests(req, res);
    }

    async getSentFriendRequests(req, res) {
        await SocialService.getSentFriendRequests(req, res);
    }

    async getBlockedUsers(req, res) {
        await SocialService.getBlockedUsers(req, res);
    }

    async blockUser(req, res) {
        await SocialService.blockUser(req, res);
    }

    async unblockUser(req, res) {
        await SocialService.unblockUser(req, res);
    }

    async sendCoins(req, res) {
        await SocialService.sendCoins(req, res);
    }

    async reportUser(req, res) {
        await SocialService.reportUser(req, res);
    }

    async reportMessage(req, res) {
        await SocialService.reportMessage(req, res);
    }
}

module.exports = new SocialController();
