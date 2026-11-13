`include "defs.svh"
`include "missing_localparams.svh"

module sat_alu (
  input  logic clk,
  input  logic [`DATA_W-1:0] a,
  input  logic [`DATA_W-1:0] b,
  output logic [`DATA_W-1:0] y
);
  always_ff @(posedge clk) begin
    y <= (a + b > 32'hFFFF_FFFF) ? 32'hFFFF_FFFF : a + b;
  end
endmodule
