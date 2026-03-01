const AdminUserService = require("../services/adminUser.service");

class AdminUserController {
    /**
     * List users
     */
    async listUsers(req, res) {
        try {
            const { page, limit, search } = req.query;
            const data = await AdminUserService.listUsers(page, limit, search);

            return res.status(200).json({
                success: true,
                message: "Users fetched successfully",
                data
            });
        } catch (error) {
            console.error("Admin List Users Error:", error);
            return res.status(400).json({ success: false, message: error.message });
        }
    }

    /**
     * Get user detail
     */
    async getUserDetail(req, res) {
        try {
            const { id } = req.params;
            const user = await AdminUserService.getUserDetail(id);
            const matches = await AdminUserService.getUserMatches(id);

            return res.status(200).json({
                success: true,
                message: "User detail fetched successfully",
                data: { user, matches }
            });
        } catch (error) {
            console.error("Admin Get User Detail Error:", error);
            return res.status(400).json({ success: false, message: error.message });
        }
    }

    /**
     * Toggle active status
     */
    async toggleStatus(req, res) {
        try {
            const { id } = req.params;
            const user = await AdminUserService.toggleUserStatus(id);

            return res.status(200).json({
                success: true,
                message: `User ${user.isActive ? "activated" : "deactivated"} successfully`,
                data: user
            });
        } catch (error) {
            console.error("Admin Toggle Status Error:", error);
            return res.status(400).json({ success: false, message: error.message });
        }
    }

    /**
     * Soft delete user
     */
    async softDelete(req, res) {
        try {
            const { id } = req.params;
            const result = await AdminUserService.softDeleteUser(id);

            return res.status(200).json({
                success: true,
                message: result.message
            });
        } catch (error) {
            console.error("Admin Soft Delete Error:", error);
            return res.status(400).json({ success: false, message: error.message });
        }
    }
}

module.exports = new AdminUserController();
