import logger from "@overleaf/logger";
import SessionManager from "../../../../app/src/Features/Authentication/SessionManager.mjs";
import EmailHandler from "../../../../app/src/Features/Email/EmailHandler.mjs";
import TokenManager, {
  MAX_TOKENS_PER_USER,
  PERSONAL_MCP_SCOPE,
  PERSONAL_MCP_WRITE_SCOPE,
} from "./PersonalMcpTokenManager.mjs";

// The alert wording mirrors the granted scope, so the account owner always
// sees whether the new token was read-only or read-write.
async function _sendSecurityAlertNewMcpToken(user, scope) {
  const what = scope === PERSONAL_MCP_WRITE_SCOPE ? "read-write" : "read-only";
  const emailOptions = {
    to: user.email,
    actionDescribed: `a new ${what} MCP access token has been generated for your account ${user.email}`,
    action: `new ${what} MCP access token generated`,
  };
  try {
    await EmailHandler.promises.sendEmail("securityAlert", emailOptions);
  } catch (error) {
    // log error when sending security alert email but do not pass back
    logger.error(
      { error, userId: user._id },
      "could not send security alert new MCP access token generated",
    );
  }
}

// Session + CSRF only (mounted on webRouter behind requireLogin). The raw
// token is returned exactly once, from createToken.
const PersonalMcpTokensController = {
  async getTokens(req, res) {
    const user = SessionManager.getSessionUser(req.session);
    if (!user) return res.sendStatus(401);
    try {
      const tokens = await TokenManager.listTokens(user._id);
      return res.json({ tokens });
    } catch (error) {
      logger.error(
        { error, userId: user._id },
        "personal-mcp: failed to list tokens",
      );
      return res.sendStatus(500);
    }
  },

  async createToken(req, res) {
    const user = SessionManager.getSessionUser(req.session);
    if (!user) return res.sendStatus(401);
    const purpose =
      typeof req.body?.purpose === "string"
        ? req.body.purpose.trim().substring(0, 200)
        : "";
    // Scope comes from the session+CSRF protected web form, never from an MCP
    // request body. Unknown scope values are rejected with 400.
    const requestedScope = req.body?.scope;
    let scope = PERSONAL_MCP_SCOPE;
    if (requestedScope != null && requestedScope !== "") {
      if (
        requestedScope === "read_write" ||
        requestedScope === PERSONAL_MCP_WRITE_SCOPE
      ) {
        scope = PERSONAL_MCP_WRITE_SCOPE;
      } else if (
        requestedScope !== "read" &&
        requestedScope !== PERSONAL_MCP_SCOPE
      ) {
        return res.status(400).json({ error: "invalid scope" });
      }
    }
    try {
      const count = await TokenManager.countForUser(user._id);
      if (count >= MAX_TOKENS_PER_USER) return res.sendStatus(403);
      const token = await TokenManager.createToken(user._id, purpose, scope);
      // Audit log: ids and scope only, never the token value.
      logger.info(
        { userId: user._id, tokenId: token.id, scope },
        "personal-mcp: access token created",
      );
      _sendSecurityAlertNewMcpToken(user, scope);
      return res.status(201).json(token);
    } catch (error) {
      logger.error(
        { error, userId: user._id },
        "personal-mcp: failed to create token",
      );
      return res.sendStatus(500);
    }
  },

  async deleteToken(req, res) {
    const user = SessionManager.getSessionUser(req.session);
    if (!user) return res.sendStatus(401);
    const tokenId = req.params?.token_id;
    try {
      // Owner-scoped delete: another user's token id yields a 404.
      const deleted = await TokenManager.revokeToken(user._id, tokenId);
      if (!deleted) return res.sendStatus(404);
      logger.info(
        { userId: user._id, tokenId },
        "personal-mcp: access token revoked",
      );
      return res.sendStatus(204);
    } catch (error) {
      logger.error(
        { error, userId: user._id, tokenId },
        "personal-mcp: failed to revoke token",
      );
      return res.sendStatus(500);
    }
  },
};

export default PersonalMcpTokensController;
