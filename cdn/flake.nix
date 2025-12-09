{
  description = "MoQ relay server dependencies";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
    flake-utils.url = "github:numtide/flake-utils";
    moq = {
      # Unfortunately, we can't use a relative path here because it executes on the remote.
      # TODO cross-compile locally and upload the binary to the remote.
      url = "github:kixelated/moq";
    };
  };

  outputs =
    {
      nixpkgs,
      flake-utils,
      moq,
      ...
    }:
    {
      # Linux-only packages for deployment
      packages.x86_64-linux =
        let
          system = "x86_64-linux";
          pkgs = nixpkgs.legacyPackages.${system};
        in
        {
          default = pkgs.certbot.withPlugins (ps: [ ps.certbot-dns-google ]);
          certbot = pkgs.certbot.withPlugins (ps: [ ps.certbot-dns-google ]);
          moq-relay = moq.packages.${system}.moq-relay;
          cachix = pkgs.cachix;
          ffmpeg = pkgs.ffmpeg;
          hang-cli = moq.packages.${system}.hang;
        };
    }
    // flake-utils.lib.eachDefaultSystem (system: {
      # Dev shell available on all systems
      devShells.default = nixpkgs.legacyPackages.${system}.mkShell {
        packages = with nixpkgs.legacyPackages.${system}; [
          opentofu
        ];
      };
    });
}
