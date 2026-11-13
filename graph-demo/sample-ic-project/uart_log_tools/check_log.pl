#!/usr/bin/perl
use strict;
use warnings;
require "./uart_rx.pl";
require "./missing_helper.pl";

sub main {
  my $line = shift;
  my $frame = uart_parse_frame($line);
  print "frame=$frame\n";
}

main(@ARGV);
