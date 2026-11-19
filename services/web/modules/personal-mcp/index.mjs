import logger from "@overleaf/logger";
import Settings from "@overleaf/settings";
import { db } from "../../app/src/infrastructure/mongodb.mjs";
import Modules from "../../app/src/infrastructure/Modules.mjs";
import PersonalMcpRouter from "./app/src/PersonalMcpRouter.mjs";
import {
  PERSONAL_MCP_SCOPES,
  TOKEN_TYPE,
} from "./app/src/PersonalMcpTokenManager.mjs";

let PersonalMcpModule = {};

if (process.env.PERSONAL_MCP_ENABLED === "true") {
  logger.debug({}, "Enabling personal-mcp module");

  Settings.enablePersonalMcp = true;

  // Delete all user's personal MCP tokens on user expire (hook 'expireDeletedUser').
  Modules.hooks.attach("expireDeletedUser", async (userId) => {
    try {
      const query = {
        user_id: userId,
        type: TOKEN_TYPE,
        // Both token families (read and read-write) must die with the user.
        scope: { $in: PERSONAL_MCP_SCOPES },
      };
      await db.oauthAccessTokens.deleteMany(query);
    } catch (err) {
      logger.warn(
        { userId, err },
        "on user expire: failed deleting personal-mcp tokens",
      );
    }
  });

  PersonalMcpModule = {
    router: PersonalMcpRouter,
  };
}

export default PersonalMcpModule;
