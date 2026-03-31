{
  lib,
  stdenv,
  nodejs_22,
  pnpm,
  pnpmConfigHook,
  fetchPnpmDeps,
  envVars ? {},
}:

let
  envFile = builtins.toFile ".env"
    (lib.concatStringsSep "\n" (lib.mapAttrsToList (k: v: "${k}=${v}") envVars));
in
stdenv.mkDerivation (finalAttrs: {
  pname = "plan-ai-chat";
  version = "0.7.2";

  src = lib.fileset.toSource {
    root = ./.;
    fileset = lib.fileset.difference ./. (
      lib.fileset.unions (
        map lib.fileset.maybeMissing [
          ./dist
          ./.env.local
        ] ++ [
          ./flake.nix
          ./flake.lock
          ./package.nix
          ./module.nix
          ./.env.example
          ./.env.development.example
        ]
      )
    );
  };

  nativeBuildInputs = [
    nodejs_22
    pnpm
    pnpmConfigHook
  ];

  pnpmDeps = fetchPnpmDeps {
    inherit (finalAttrs) pname version src;
    fetcherVersion = 3;
    hash = "sha256-PuzEQPs+OaONnkT3dsLluKx2bim1rO0xBLDU3QT9hos=";
  };

  buildPhase = ''
    runHook preBuild
    ${lib.optionalString (envVars != {}) "cp ${envFile} .env"}
    ${lib.concatStringsSep "\n" (lib.mapAttrsToList (k: v: "export ${k}=${lib.escapeShellArg v}") envVars)}
    pnpm build
    runHook postBuild
  '';

  installPhase = ''
    runHook preInstall

    mkdir -p $out/share/plan-ai-chat/dist

    # Server entry + chunks
    cp -r dist/server $out/share/plan-ai-chat/dist/server

    # Static client assets
    cp -r dist/client $out/share/plan-ai-chat/dist/client

    # Runtime deps (Astro SSR externalises @anthropic-ai/sdk, @supabase/supabase-js, etc.)
    cp -r node_modules $out/share/plan-ai-chat/node_modules

    # Production server wrapper (imports from ./dist/)
    cp server.mjs $out/share/plan-ai-chat/server.mjs

    # Wrapper script to start the production server
    mkdir -p $out/bin
    cat > $out/bin/plan-ai-chat <<EOF
#!/usr/bin/env bash
exec ${nodejs_22}/bin/node $out/share/plan-ai-chat/server.mjs "\$@"
EOF
    chmod +x $out/bin/plan-ai-chat

    runHook postInstall
  '';

  meta = {
    description = "The plan.ai chat (Astro + Node SSR)";
    mainProgram = "plan-ai-chat";
  };
})
