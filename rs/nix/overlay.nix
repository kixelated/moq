# Accept crane as argument to the overlay
{ crane }:
final: prev:
let
  craneLib = crane.mkLib final;
in
{
  moq-relay = craneLib.buildPackage {
    pname = "moq-relay";
    src = craneLib.cleanCargoSource ../.;
    cargoExtraArgs = "-p moq-relay";
  };

  moq-clock = craneLib.buildPackage {
    pname = "moq-clock";
    src = craneLib.cleanCargoSource ../.;
    cargoExtraArgs = "-p moq-clock";
  };

  hang = craneLib.buildPackage {
    pname = "hang";
    src = craneLib.cleanCargoSource ../.;
    cargoExtraArgs = "-p hang";
  };

  moq-token = craneLib.buildPackage {
    pname = "moq-token-cli";
    src = craneLib.cleanCargoSource ../.;
    cargoExtraArgs = "-p moq-token-cli";
  };
}
