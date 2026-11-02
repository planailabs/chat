-- Whether purchases (console tools that cost money) may be made from an MCP
-- client signed in through /public/mcp. Off unless the user turns it on;
-- each purchase is still confirmed with its price in the client.
ALTER TABLE profiles ADD COLUMN mcp_purchases boolean NOT NULL DEFAULT false;
