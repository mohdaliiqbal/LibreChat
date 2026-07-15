const express = require('express');
const { createAdminUsersHandlers, getBalanceConfig } = require('@librechat/api');
const { SystemCapabilities } = require('@librechat/data-schemas');
const { requireCapability } = require('~/server/middleware/roles/capabilities');
const { requireJwtAuth } = require('~/server/middleware');
const { getAppConfig } = require('~/server/services/Config');
const db = require('~/models');

const router = express.Router();

const requireAdminAccess = requireCapability(SystemCapabilities.ACCESS_ADMIN);
const requireReadUsers = requireCapability(SystemCapabilities.READ_USERS);
const requireManageUsers = requireCapability(SystemCapabilities.MANAGE_USERS);

const handlers = createAdminUsersHandlers({
  findUsers: db.findUsers,
  countUsers: db.countUsers,
  deleteUserById: db.deleteUserById,
  deleteConfig: db.deleteConfig,
  deleteAclEntries: db.deleteAclEntries,
  findBalanceByUser: db.findBalanceByUser,
  upsertBalanceFields: db.upsertBalanceFields,
  createTransaction: db.createTransaction,
  resolveBalanceConfig: async (req) => {
    const appConfig = await getAppConfig({ role: req.user?.role, tenantId: req.user?.tenantId });
    return getBalanceConfig(appConfig);
  },
});

router.use(requireJwtAuth, requireAdminAccess);

router.get('/', requireReadUsers, handlers.listUsers);
router.get('/search', requireReadUsers, handlers.searchUsers);
router.get('/:id/balance', requireReadUsers, handlers.getUserBalance);
router.post('/:id/balance', requireManageUsers, handlers.updateUserBalance);
// router.delete('/:id', requireManageUsers, handlers.deleteUser);

module.exports = router;
