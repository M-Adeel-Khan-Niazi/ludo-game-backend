const SocialService = require("../services/social.service");

class SocialController {

    async sendFriendRequest(req, res) {
        await SocialService.sendFriendRequest(req, res);
    }

    async acceptFriendRequest(req, res) {
        await SocialService.acceptFriendRequest(req, res);
    }

    async getFriendList(req, res) {
        await SocialService.getFriendList(req, res);
    }

    async getFriendRequests(req, res) {
        await SocialService.getFriendRequests(req, res);
    }

    async blockUser(req, res) {
        await SocialService.blockUser(req, res);
    }

    async unblockUser(req, res) {
        await SocialService.unblockUser(req, res);
    }

    async reportUser(req, res) {
        await SocialService.reportUser(req, res);
    }

    async reportMessage(req, res) {
        await SocialService.reportMessage(req, res);
    }
}

module.exports = new SocialController();
