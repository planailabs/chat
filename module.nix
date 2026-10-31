{ config, lib, pkgs, ... }:

let
  cfg = config.services.plan-ai-chat;
  settingsFormat = pkgs.formats.toml { };
  configFile = settingsFormat.generate "plan-ai-chat.toml" (lib.recursiveUpdate { web.static_dir = "${cfg.webPackage}"; } cfg.settings);
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

    createDatabase = lib.mkOption {
      type = lib.types.bool;
      default = true;
      description = "Create a local Postgres database and role `plan-ai-chat` (peer auth); point settings.database.url at it.";
    };
  };

  config = lib.mkIf cfg.enable {
    services.plan-ai-chat.settings.database.url = lib.mkIf cfg.createDatabase (lib.mkDefault "postgres:///plan-ai-chat?host=/run/postgresql");

    services.postgresql = lib.mkIf cfg.createDatabase {
      enable = true;
      ensureDatabases = [ "plan-ai-chat" ];
      ensureUsers = [{ name = "plan-ai-chat"; ensureDBOwnership = true; }];
    };

    users.users.plan-ai-chat = { isSystemUser = true; group = "plan-ai-chat"; };
    users.groups.plan-ai-chat = { };

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
