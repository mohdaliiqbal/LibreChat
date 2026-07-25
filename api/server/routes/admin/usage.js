const express = require('express');
const { createAdminUsageHandlers } = require('@librechat/api');
const { SystemCapabilities, tokenValues } = require('@librechat/data-schemas');
const { requireCapability } = require('~/server/middleware/roles/capabilities');
const { requireJwtAuth } = require('~/server/middleware');
const db = require('~/models');

const router = express.Router();

const requireAdminAccess = requireCapability(SystemCapabilities.ACCESS_ADMIN);
const requireReadUsers = requireCapability(SystemCapabilities.READ_USERS);

const handlers = createAdminUsageHandlers({
  getTransactions: db.getTransactions,
  findUsers: db.findUsers,
  // Static USD-per-1M-token registry — surfaced so admins can see configured model cost.
  modelPricing: tokenValues,
});

router.use(requireJwtAuth, requireAdminAccess);

router.get('/summary', requireReadUsers, handlers.getUsageSummary);

module.exports = router;
