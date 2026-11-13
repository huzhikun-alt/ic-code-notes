package uart_rx;
use strict;
use Exporter 'import';
our @EXPORT_OK = qw(uart_parse_frame uart_crc);

sub uart_parse_frame {
  my ($line) = @_;
  my ($ts, $payload) = split /:/, $line, 2;
  return { ts => $ts, payload => $payload, crc => uart_crc($payload) };
}

sub uart_crc { return 0x5a; }
1;
