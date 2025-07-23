# Accept crane as argument to the overlay
{ crane }:
final: prev:
let
  craneLib = crane.mkLib final;
  
  # Helper function to get crate info from Cargo.toml
  crateInfo = cargoTomlPath: craneLib.crateNameFromCargoToml { cargoToml = cargoTomlPath; };
in
{
  moq-relay = craneLib.buildPackage (
    crateInfo ../moq-relay/Cargo.toml
    // {
      src = craneLib.cleanCargoSource ../.;
      cargoExtraArgs = "-p moq-relay";
    }
  );

  moq-clock = craneLib.buildPackage (
    crateInfo ../moq-clock/Cargo.toml
    // {
      src = craneLib.cleanCargoSource ../.;
      cargoExtraArgs = "-p moq-clock";
    }
  );

  hang = craneLib.buildPackage (
    crateInfo ../hang-cli/Cargo.toml
    // {
      src = craneLib.cleanCargoSource ../.;
      cargoExtraArgs = "-p hang-cli";
    }
  );

  moq-token = craneLib.buildPackage (
    crateInfo ../moq-token-cli/Cargo.toml
    // {
      src = craneLib.cleanCargoSource ../.;
      cargoExtraArgs = "-p moq-token-cli";
    }
  );
}
