`include "defs.svh"

module tb_top;
  logic clk;
  logic [`DATA_W-1:0] a, b, y;

  sat_alu u_alu (.clk(clk), .a(a), .b(b), .y(y));

  initial begin
    $display("tb_top start");
  end
endmodule
