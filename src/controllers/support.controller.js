const SupportService = require("../services/support.service");

class SupportController {

    async createTicket(req, res) {
        await SupportService.createTicket(req, res);
    }

    async getAllTickets(req, res) {
        await SupportService.getAllTickets(req, res);
    }

    async getTicketById(req, res) {
        await SupportService.getTicketById(req, res);
    }

    async replyToTicket(req, res) {
        await SupportService.replyToTicket(req, res);
    }

    async updateTicketStatus(req, res) {
        await SupportService.updateTicketStatus(req, res);
    }
}

module.exports = new SupportController();
