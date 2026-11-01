{ config, lib, pkgs, ... }:

let
  cfg = config.services.plan-ai-chat;
  settingsFormat = pkgs.formats.toml { };
  configFile = settingsFormat.generate "plan-ai-chat.toml" (lib.recursiveUpdate { web.static_dir = "${cfg.webPackage}"; } cfg.settings);
  listen = cfg.settings.web.listen or "127.0.0.1:8080";
  # The cluster file calls the chat server back at its address.
  clusterFile = pkgs.runCommand "chat.hcl" { } ''
    substitute ${cfg.package}/share/plan-ai-chat/chat.hcl $out \
      --replace-fail "http://127.0.0.1:8080" "http://${listen}"
  '';
in
{
  options.services.plan-ai-chat = {
    enable = lib.mkEnableOption "plan.ai chat";

    package = lib.mkOption {
      type = lib.types.package;
      default = pkgs.plan-ai-chat;
      description = "The chat server.";
    };

    webPackage = lib.mkOption {
      type = lib.types.package;
      default = pkgs.plan-ai-chat-web;
      description = "The chat UI it serves (web.static_dir).";
    };

    settings = lib.mkOption {
      type = settingsFormat.type;
      default = { };
      description = ''
        config.toml (see config.example.toml). It lands in the world-readable
        Nix store; put secrets in {option}`secretsFile` to keep them out.
      '';
    };

    secretsFile = lib.mkOption {
      type = lib.types.nullOr lib.types.path;
      default = null;
      example = "/run/secrets/plan-ai-chat.toml";
      description = "TOML merged over the settings at start (CONFIG_SECRETS_PATH), read as a systemd credential.";
    };

    hub = {
      enable = lib.mkOption {
        type = lib.types.bool;
        default = true;
        description = ''
          Run the agents' subagent-net hub and node on this host (`subnet dev`
          with the package's chat.hcl, its own database `plan-ai-chat-subnet`).
          Its admin token and the callback secret are the chat's
          settings.subnet.token and settings.subnet.callback_secret.
        '';
      };
      package = lib.mkOption {
        type = lib.types.package;
        default = pkgs.subnet;
        description = "subagent-net.";
      };
      listen = lib.mkOption {
        type = lib.types.str;
        default = "127.0.0.1:7700";
        description = "The hub's address (settings.subnet.url points at it).";
      };
      litellmApiKey = lib.mkOption {
        type = lib.types.str;
        description = "LiteLLM key the agents' model calls use (lands in the Nix store, like the settings).";
      };
    };

    createDatabase = lib.mkOption {
      type = lib.types.bool;
      default = true;
      description = "Create a local Postgres database and role `plan-ai-chat` (peer auth); point settings.database.url at it.";
    };
  };

  config = lib.mkIf cfg.enable {
    services.plan-ai-chat.settings.database.url = lib.mkIf cfg.createDatabase (lib.mkDefault "postgres://plan-ai-chat@localhost/plan-ai-chat?host=/run/postgresql");

    services.plan-ai-chat.settings.subnet.url = lib.mkIf cfg.hub.enable (lib.mkDefault "http://${cfg.hub.listen}");

    services.postgresql = lib.mkIf (cfg.createDatabase || cfg.hub.enable) {
      enable = true;
      ensureDatabases = lib.optional cfg.createDatabase "plan-ai-chat" ++ lib.optional cfg.hub.enable "plan-ai-chat-subnet";
      ensureUsers = lib.optional cfg.createDatabase { name = "plan-ai-chat"; ensureDBOwnership = true; }
        ++ lib.optional cfg.hub.enable { name = "plan-ai-chat-subnet"; ensureDBOwnership = true; };
    };

    users.users.plan-ai-chat = { isSystemUser = true; group = "plan-ai-chat"; };
    users.groups.plan-ai-chat = { };
    users.users.plan-ai-chat-subnet = lib.mkIf cfg.hub.enable { isSystemUser = true; group = "plan-ai-chat-subnet"; };
    users.groups.plan-ai-chat-subnet = lib.mkIf cfg.hub.enable { };

    systemd.services.plan-ai-chat-subnet = lib.mkIf cfg.hub.enable {
      description = "plan.ai chat agents (subagent-net hub + node)";
      wantedBy = [ "multi-user.target" ];
      after = [ "network.target" "postgresql.service" "plan-ai-chat.service" ];
      requires = [ "postgresql.service" ];
      environment = {
        DATABASE_URL = "postgres://plan-ai-chat-subnet@localhost/plan-ai-chat-subnet?host=/run/postgresql";
        SUBNET_LISTEN = cfg.hub.listen;
        SUBNET_ADMIN_TOKEN = cfg.settings.subnet.token;
        CHAT_CALLBACK_SECRET = cfg.settings.subnet.callback_secret;
        LITELLM_API_KEY = cfg.hub.litellmApiKey;
      };
      serviceConfig = {
        # The node loads the chat's MCP servers once at start: wait until the
        # chat listens, or the agents come up without their tools.
        ExecStartPre = pkgs.writeShellScript "wait-for-chat" ''
          for _ in $(seq 80); do
            ${lib.getExe pkgs.curl} -s -o /dev/null http://${listen}/ && exit 0
            sleep 1
          done
          echo "chat at ${listen} didn't come up" >&2
          exit 1
        '';
        ExecStart = "${lib.getExe' cfg.hub.package "subnet"} dev ${clusterFile}";
        Restart = "on-failure";
        RestartSec = 5;
        User = "plan-ai-chat-subnet";
        Group = "plan-ai-chat-subnet";
        NoNewPrivileges = true;
        ProtectSystem = "strict";
        ProtectHome = true;
        PrivateTmp = true;
        PrivateDevices = true;
      };
    };

    systemd.services.plan-ai-chat = {
      description = "plan.ai chat";
      wantedBy = [ "multi-user.target" ];
      after = [ "network.target" ] ++ lib.optional cfg.createDatabase "postgresql.service";
      requires = lib.optional cfg.createDatabase "postgresql.service";

      environment = {
        CONFIG_PATH = configFile;
      } // lib.optionalAttrs (cfg.secretsFile != null) {
        CONFIG_SECRETS_PATH = "%d/secrets";
      };

      serviceConfig = {
        Type = "simple";
        ExecStart = lib.getExe cfg.package;
        Restart = "on-failure";
        RestartSec = 5;
        User = "plan-ai-chat";
        Group = "plan-ai-chat";
        NoNewPrivileges = true;
        ProtectSystem = "strict";
        ProtectHome = true;
        PrivateTmp = true;
        PrivateDevices = true;
        ProtectKernelTunables = true;
        ProtectKernelModules = true;
        ProtectControlGroups = true;
        RestrictNamespaces = true;
        RestrictSUIDSGID = true;
      } // lib.optionalAttrs (cfg.secretsFile != null) {
        LoadCredential = "secrets:${cfg.secretsFile}";
      };
    };
  };
}
