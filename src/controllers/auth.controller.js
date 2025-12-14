class Controller {
  constructor() {
    this.service = require("../services/auth.service");
  }

  async signUpUser(req, res) {
    await this.service.signUpUser(req, res);
  }

  async signIn(req, res) {
    await this.service.signIn(req, res);
  }

  async verifyOTP(req, res) {
    await this.service.verifyOTP(req, res);
  }

  async resendOTP(req, res) {
    await this.service.resendOTP(req, res);
  }

  async socialLogin(req, res) {
    await this.service.socialLogin(req, res);
  }

  async signOut(req, res) {
    await this.service.signOut(req, res);
  }

  async adminSignIn(req, res) {
    await this.service.adminSignIn(req, res);
  }

  async setLanguage(req, res) {
    await this.service.setLanguage(req, res);
  }

  async checkAvailability(req, res) {
    await this.service.checkAvailability(req, res);
  }
  
  async updateProfile(req, res) {
    await this.service.updateProfile(req, res);
  }

  async getProfile(req, res) {
    await this.service.getProfile(req, res);
  }

  async updatePassword(req, res) {
    await this.service.updatePassword(req, res);
  }

  async deleteAccount(req, res) {
    await this.service.deleteAccount(req, res);
  }

  async forgotPassword(req, res) {
    await this.service.forgotPassword(req, res);
  }

  async resetPassword(req, res) {
    await this.service.resetPassword(req, res);
  }
}

module.exports = new Controller();
