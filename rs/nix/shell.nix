{
  self,
  nixpkgs,
  flake-utils,
  fenix,
  ...
}:
flake-utils.lib.eachDefaultSystem (
  system:
  let
    pkgs = nixpkgs.legacyPackages.${system};
  in
  {
    devShells = {
      default =
        with pkgs;
        mkShell {
          nativeBuildInputs = [
            pkg-config
            libressl
            cargo
            rustfmt
            ffmpeg
          ];
          LIBCLANG_PATH = "${pkgs.libclang.lib}/lib";
        };

      web =
        let
          rustToolchain =
            with fenix.packages.${system};
            combine [
              latest.rustc
              latest.cargo
            ];
        in
        with pkgs;
        mkShell {
          nativeBuildInputs = [
            rustToolchain
          ];
        };
    };
  }
)
