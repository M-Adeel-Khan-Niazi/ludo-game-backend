const Ticket = require("../models/Ticket");
const { handlers } = require("../utils/response-handlers");

class SupportService {

    // Create a new ticket
    async createTicket(req, res) {
        try {
            const { subject, description, priority } = req.body;
            const userId = req.user._id;

            const ticket = await Ticket.create({
                user: userId,
                subject,
                description,
                priority,
            });

            return handlers.response.success({
                res,
                message: "Ticket created successfully",
                data: ticket,
            });
        } catch (error) {
            return handlers.response.error({ res, error, message: error.message });
        }
    }

    // Get all tickets (Admin sees all, User sees own)
    async getAllTickets(req, res) {
        try {
            const { status, priority, page = 1, limit = 10 } = req.query;
            const userId = req.user._id;
            const userRole = req.user.role;

            const query = {};

            if (userRole !== "admin") {
                query.user = userId;
            }

            if (status) query.status = status;
            if (priority) query.priority = priority;

            const tickets = await Ticket.find(query)
                .populate("user", "fullName email")
                .sort({ createdAt: -1 })
                .skip((page - 1) * limit)
                .limit(Number(limit));

            const total = await Ticket.countDocuments(query);

            return handlers.response.success({
                res,
                data: tickets,
                pagination: {
                    total,
                    page: Number(page),
                    limit: Number(limit),
                    pages: Math.ceil(total / limit),
                },
            });
        } catch (error) {
            return handlers.response.error({ res, error, message: error.message });
        }
    }

    // Get single ticket by ID
    async getTicketById(req, res) {
        try {
            const { id } = req.params;
            const userId = req.user._id;
            const userRole = req.user.role;

            const ticket = await Ticket.findById(id).populate("user", "fullName email").populate("messages.sender", "fullName role");

            if (!ticket) {
                return handlers.response.notFound({ res, message: "Ticket not found" });
            }

            if (userRole !== "admin" && ticket.user._id.toString() !== userId.toString()) {
                return handlers.response.unauthorized({ res, message: "Unauthorized access to this ticket" });
            }

            return handlers.response.success({
                res,
                data: ticket,
            });
        } catch (error) {
            return handlers.response.error({ res, error, message: error.message });
        }
    }

    // Reply to a ticket
    async replyToTicket(req, res) {
        try {
            const { id } = req.params;
            const { message } = req.body;
            const userId = req.user._id;
            const userRole = req.user.role;

            const ticket = await Ticket.findById(id);

            if (!ticket) {
                return handlers.response.notFound({ res, message: "Ticket not found" });
            }

            if (userRole !== "admin" && ticket.user.toString() !== userId.toString()) {
                return handlers.response.unauthorized({ res, message: "Unauthorized access to this ticket" });
            }

            ticket.messages.push({
                sender: userId,
                message,
            });

            await ticket.save();

            return handlers.response.success({
                res,
                message: "Reply added successfully",
                data: ticket,
            });
        } catch (error) {
            return handlers.response.error({ res, error, message: error.message });
        }
    }

    // Update ticket status (Admin only)
    async updateTicketStatus(req, res) {
        try {
            const { id } = req.params;
            const { status } = req.body;

            // Admin check logic relies on route middleware or manual check if not present?
            // User used `authenticateJwt` but removed `checkRole`.
            // I should enforce admin check here if route middleware doesn't.
            // The current routes/users/support.route.js DOES NOT include checkRole middleware.
            // So I must check it here.

            if (req.user.role !== "admin") {
                return handlers.response.unauthorized({ res, message: "Admins only" });
            }

            const ticket = await Ticket.findByIdAndUpdate(id, { status }, { new: true });

            if (!ticket) {
                return handlers.response.notFound({ res, message: "Ticket not found" });
            }

            return handlers.response.success({
                res,
                message: "Ticket status updated",
                data: ticket,
            });
        } catch (error) {
            return handlers.response.error({ res, error, message: error.message });
        }
    }
}

module.exports = new SupportService();
