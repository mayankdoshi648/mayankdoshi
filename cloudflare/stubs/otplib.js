'use strict';

/** otplib stub — PIN/TOTP login is Node-only on Cloudflare free deploy. */
module.exports = {
  authenticator: {
    generate() {
      throw new Error('PIN/TOTP login is not available on Cloudflare. Use Client ID + Access Token.');
    },
  },
};
