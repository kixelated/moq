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

          moq-token = naersk'.buildPackage {
            pname = "moq-token-cli";
            src = ./.;
            cargoBuildOptions =
              opts:
              opts
              ++ [
                "-p"
                "moq-token-cli"
              ];
            cargoTestOptions =
              opts:
              opts
              ++ [
                "-p"
                "moq-token-cli"
              ];
          };

          default = naersk'.buildPackage {
            src = ./.;
          };

          # Docker images
          moq-clock-docker = pkgs.dockerTools.buildImage {
            name = "moq-clock";
            tag = "latest";
            copyToRoot = pkgs.buildEnv {
              name = "image-root";
              paths = [ self.packages.${system}.moq-clock ];
              pathsToLink = [ "/bin" ];
            };
            config = {
              Entrypoint = [ "/bin/moq-clock" ];
            };
          };

          hang-docker = pkgs.dockerTools.buildImage {
            name = "hang";
            tag = "latest";
            copyToRoot = pkgs.buildEnv {
              name = "image-root";
              paths = [
                self.packages.${system}.hang
                pkgs.ffmpeg
                pkgs.wget
              ];
              pathsToLink = [ "/bin" ];
            };
            config = {
              Entrypoint = [ "/bin/hang" ];
            };
            extraCommands = ''
              mkdir -p usr/local/bin
              cp ${./hang-bbb} usr/local/bin/hang-bbb
              chmod +x usr/local/bin/hang-bbb
            '';
          };

          moq-relay-docker = pkgs.dockerTools.buildImage {
            name = "moq-relay";
            tag = "latest";
            copyToRoot = pkgs.buildEnv {
              name = "image-root";
              paths = [ self.packages.${system}.moq-relay ];
              pathsToLink = [ "/bin" ];
            };
            config = {
              Entrypoint = [ "/bin/moq-relay" ];
            };
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
