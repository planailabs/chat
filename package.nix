# The Rust chat server and its static UI (web/), as two packages: the
# module points the server at the UI (`web.static_dir`).
{
  lib,
  rustPlatform,
  stdenv,
  nodejs_22,
  pnpm,
  pnpmConfigHook,
  fetchPnpmDeps,
  fetchurl,
}:

let
  version = "0.8.0";
  # utoipa-swagger-ui's build.rs downloads Swagger UI unless pointed at a copy.
  swagger-ui = fetchurl {
    url = "https://github.com/swagger-api/swagger-ui/archive/refs/tags/v5.17.14.zip";
    hash = "sha256-SBJE0IEgl7Efuu73n3HZQrFxYX+cn5UU5jrL4T5xzNw=";
  };
in
{
  server = rustPlatform.buildRustPackage {
    pname = "plan-ai-chat";
    inherit version;
    src = lib.fileset.toSource {
      root = ./.;
      fileset = lib.fileset.unions [
        ./Cargo.toml
        ./Cargo.lock
        ./config.example.toml
        ./server
        ./common
        ./generative-ui
        ./subnet
      ];
    };
    cargoLock.lockFile = ./Cargo.lock;
    SWAGGER_UI_DOWNLOAD_URL = "file://${swagger-ui}";
    # Like the other plan.ai servers: utoipa-swagger-ui's build script fails in
    # the check phase's rebuild; `cargo test` runs in the dev shell instead.
    doCheck = false;
    # The agents' cluster file, run by the module's hub.
    postInstall = ''
      install -Dm644 subnet/chat.hcl $out/share/plan-ai-chat/chat.hcl
    '';
    meta.mainProgram = "plan-ai-chat-server";
  };

  web = stdenv.mkDerivation (finalAttrs: {
    pname = "plan-ai-chat-web";
    inherit version;
    src = ./web;
    nativeBuildInputs = [ nodejs_22 pnpm pnpmConfigHook ];
    pnpmDeps = fetchPnpmDeps {
      inherit (finalAttrs) pname version src;
      fetcherVersion = 4;
      hash = "sha256-aYRQ5pdCheFApGFZJUC+LjMHQN0x7h2Xy7hDUzV7Lqo=";
    };
    buildPhase = ''
      runHook preBuild
      pnpm build
      runHook postBuild
    '';
    installPhase = ''
      runHook preInstall
      cp -r dist $out
      runHook postInstall
    '';
  });
}
