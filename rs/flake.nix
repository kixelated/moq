{
  description = "MoQ";

  inputs = {
    nixpkgs.url      = "github:NixOS/nixpkgs/nixos-unstable";
    flake-utils.url  = "github:numtide/flake-utils";
    fenix.url        = "github:nix-community/fenix";
    naersk.url       = "github:nmattia/naersk";
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
      
      overlays.default = import ./nix/overlay.nix;
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
            targets.wasm32-unknown-unknown.stable.rust-std
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
          gst-libav
        ];

        common-deps = [
          rust
          pkgs.just
          pkgs.pkg-config
          pkgs.glib
          pkgs.libressl
          pkgs.ffmpeg
        ] ++ gst-deps;

      in
      {
        packages = {
          moq-clock = naersk'.buildPackage {
            pname = "moq-clock";
            src = ./.;
          };

          moq-relay = naersk'.buildPackage {
            pname = "moq-relay";
            src = ./.;
          };

          hang = naersk'.buildPackage {
            pname = "hang";
            src = ./.;
          };

          default = naersk'.buildPackage {
            src = ./.;
          };
        };

        devShells.default = pkgs.mkShell {
          packages = common-deps ++ [
            pkgs.cargo-sort
            pkgs.cargo-shear
            pkgs.cargo-audit
          ];
          
          # Environment variables from moq-rs
          shellHook = ''
            export LIBCLANG_PATH="${pkgs.libclang.lib}/lib"
            
            # Indicator that this flake is being used
            echo "🚀 Using Gordy's MoQ Development Environment"
            echo "📦 Flake: $(pwd)/flake.nix"
            echo "🔧 Rust toolchain, GStreamer, FFmpeg, and MoQ tools loaded"
            echo ""
          '';
        };
      }
    );
}