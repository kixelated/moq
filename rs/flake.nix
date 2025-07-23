{
  description = "MoQ";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
    flake-utils.url = "github:numtide/flake-utils";
    fenix.url = "github:nix-community/fenix";
    naersk.url = "github:nmattia/naersk";
  };

  outputs =
    {
      self,
      fenix,
      nixpkgs,
      flake-utils,
      naersk,
    }:
    {
      nixosModules = {
        moq-relay = import ./nix/modules/moq-relay.nix;
      };

      overlays.default = import ./nix/overlay.nix { inherit fenix naersk; };
    }
    // flake-utils.lib.eachDefaultSystem (
      system:
      let
        pkgs = import nixpkgs {
          inherit system;
        };

        rust =
          with fenix.packages.${system};
          combine [
            stable.rustc
            stable.cargo
            stable.clippy
            stable.rustfmt
            stable.rust-src
          ];

        naersk' = naersk.lib.${system}.override {
          cargo = rust;
          rustc = rust;
        };

        gst-deps = with pkgs.gst_all_1; [
          gstreamer
          gst-plugins-base
          gst-plugins-good
          gst-plugins-bad
          gst-plugins-ugly
          gst-plugins-rs
          gst-libav
        ];

        shell-deps = [
          rust
          pkgs.just
          pkgs.pkg-config
          pkgs.glib
          pkgs.libressl
          pkgs.ffmpeg
          pkgs.curl
          pkgs.cargo-sort
          pkgs.cargo-shear
          pkgs.cargo-audit
        ] ++ gst-deps;

      in
      {
        packages = {
          default = naersk'.buildPackage {
            src = ./.;
          };

          hang-bbb = pkgs.symlinkJoin {
            name = "hang-bbb";
            paths = [
              self.packages.${system}.hang
              pkgs.ffmpeg
              pkgs.wget
              pkgs.bash
              (pkgs.writeScriptBin "hang-bbb" (builtins.readFile ./hang-bbb))
            ];
          };
        };

        devShells.default = pkgs.mkShell {
          packages = shell-deps;

          # Environment variables from moq-rs
          shellHook = ''
            export LIBCLANG_PATH="${pkgs.libclang.lib}/lib"
          '';
        };
      }
    );
}
