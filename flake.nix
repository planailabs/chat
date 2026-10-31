{
  description = "plan.ai chat";

  inputs = {
    # common/ is a submodule.
    self.submodules = true;
    nixpkgs.url = "github:NixOS/nixpkgs/nixpkgs-unstable";
    flake-utils.url = "github:numtide/flake-utils";
    # The agent hub the chat runs on (`subnet dev` in the Procfile).
    subagent-net = {
      url = "git+ssh://git@git.plan.ai/plan-ai/subagent-net";
      inputs.nixpkgs.follows = "nixpkgs";
    };
  };

  outputs = { self, nixpkgs, flake-utils, subagent-net }:
    flake-utils.lib.eachDefaultSystem (system:
      let
        pkgs = nixpkgs.legacyPackages.${system};
        chat = pkgs.callPackage ./package.nix { };
      in
      {
        packages = {
          default = chat.server;
          server = chat.server;
          web = chat.web;
        };

        devShells.default = pkgs.mkShell {
          buildInputs = with pkgs; [
            cargo
            rustc
            rustfmt
            clippy
            rust-analyzer
            nodejs_22
            pnpm
            # Local Postgres and the processes of the Procfile.
            postgresql
            overmind
            curl
            tmux
            subagent-net.packages.${system}.default
          ];
        };
      }) // {
      overlays.default = final: prev:
        let chat = final.callPackage ./package.nix { };
        in {
          plan-ai-chat = chat.server;
          plan-ai-chat-web = chat.web;
          subnet = subagent-net.packages.${final.stdenv.hostPlatform.system}.default;
        };

      # The module's packages default to this flake's own builds (its pinned
      # nixpkgs): the UI's pnpm-deps hash only holds with that nixpkgs' pnpm.
      nixosModules.default = { lib, pkgs, ... }:
        let system = pkgs.stdenv.hostPlatform.system; in {
          imports = [ ./module.nix ];
          services.plan-ai-chat = {
            package = lib.mkDefault self.packages.${system}.server;
            webPackage = lib.mkDefault self.packages.${system}.web;
            hub.package = lib.mkDefault subagent-net.packages.${system}.default;
          };
        };
    };
}
