{
  description = "plan.ai chat";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixpkgs-unstable";
    flake-utils.url = "github:numtide/flake-utils";
  };

  outputs = { self, nixpkgs, flake-utils }:
    flake-utils.lib.eachDefaultSystem (system:
      let
        pkgs = nixpkgs.legacyPackages.${system};
      in
      {
        packages.default = pkgs.callPackage ./package.nix { };

        devShells.default = pkgs.mkShell {
          buildInputs = with pkgs; [
            nodejs_22
            pnpm
            supabase-cli
          ];
        };
      }) // {
      overlays.default = final: prev: {
        plan-ai-chat = final.callPackage ./package.nix { };
      };

      nixosModules.default = import ./module.nix;
    };
}
