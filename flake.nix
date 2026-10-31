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

      nixosModules.default = import ./module.nix;
    };
}
