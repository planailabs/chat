{ config, lib, pkgs, ... }:

let
  cfg = config.services.plan-ai-chat;
in
{
  options.services.plan-ai-chat = {
    enable = lib.mkEnableOption "plan.ai chat";

    package = lib.mkOption {
      type = lib.types.package;
      description = "The plan-ai-chat package to use.";
    };

    host = lib.mkOption {
      type = lib.types.str;
      default = "127.0.0.1";
      description = "Address to bind the server to.";
    };

    port = lib.mkOption {
      type = lib.types.port;
      default = 4321;
      description = "Port to listen on.";
    };

    environmentFile = lib.mkOption {
      type = lib.types.nullOr lib.types.path;
      default = null;
      description = ''
        Path to an environment file containing secrets.
        Should define: VITE_SUPABASE_URL, VITE_SUPABASE_PUBLISHABLE_KEY,
        SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, ANTHROPIC_API_KEY, MAC_MGMT_URL.
      '';
    };
  };

  config = lib.mkIf cfg.enable {
    systemd.services.plan-ai-chat = {
      description = "plan.ai chat";
      wantedBy = [ "multi-user.target" ];
      after = [ "network.target" ];

      environment = {
        /* HOST = cfg.host;
        PORT = toString cfg.port; */
      };

      serviceConfig = {
        Type = "simple";
        ExecStart = lib.getExe cfg.package;
        Restart = "on-failure";
        RestartSec = 5;

        DynamicUser = true;
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
        MemoryDenyWriteExecute = false; # Node.js JIT needs this
      } // lib.optionalAttrs (cfg.environmentFile != null) {
        EnvironmentFile = cfg.environmentFile;
      };
    };
  };
}
