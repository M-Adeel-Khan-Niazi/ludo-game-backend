const PackageService = require("../services/package.service");
const { handlers } = require("../utils/response-handlers");

class PackageController {
  /**
   * Create a new coin package (Admin)
   */
  async createPackage(req, res) {
    try {
      const newPackage = await PackageService.createPackage(req.body);

      return res.status(201).json({
        success: true,
        message: "Package created successfully",
        data: newPackage,
      });
    } catch (error) {
      console.error("Error creating package:", error);
      return res.status(500).json({
        success: false,
        message: error.message || "Internal server error",
      });
    }
  }

  /**
   * Update a coin package (Admin)
   */
  async updatePackage(req, res) {
    try {
      const { id } = req.params;
      const updatedPackage = await PackageService.updatePackage(id, req.body);

      return res.status(200).json({
        success: true,
        message: "Package updated successfully",
        data: updatedPackage,
      });
    } catch (error) {
      console.error("Error updating package:", error);
      return res
        .status(error.message === "Package not found" ? 404 : 500)
        .json({
          success: false,
          message: error.message || "Internal server error",
        });
    }
  }

  /**
   * List all coin packages (Admin sees all, Users see active)
   */
  async listPackages(req, res) {
    try {
      const query =
        req.user && req.user.role === "admin"
          ? {}
          : {
              isActive: true,
              appleProductId: null,
              googleSku: null,
            };
      const packages = await PackageService.listPackages(query);

      return res.status(200).json({
        success: true,
        data: packages,
      });
    } catch (error) {
      console.error("Error listing packages:", error);
      return res.status(500).json({
        success: false,
        message: "Internal server error",
      });
    }
  }

  async appPackages(req, res) {
    try {
      const query = {
        isActive: true,
        appleProductId: { $ne: null },
        googleSku: { $ne: null },
      };
      const packages = await PackageService.listPackages(query);

      return res.status(200).json({
        success: true,
        data: packages,
      });
    } catch (error) {
      console.error("Error listing packages:", error);
      return res.status(500).json({
        success: false,
        message: "Internal server error",
      });
    }
  }

  /**
   * Delete a coin package (Admin)
   */
  async deletePackage(req, res) {
    try {
      const { id } = req.params;
      await PackageService.deletePackage(id);

      return res.status(200).json({
        success: true,
        message: "Package deleted successfully",
      });
    } catch (error) {
      console.error("Error deleting package:", error);
      return res
        .status(error.message === "Package not found" ? 404 : 500)
        .json({
          success: false,
          message: error.message || "Internal server error",
        });
    }
  }
}

module.exports = new PackageController();
