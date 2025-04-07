import test from 'brittle';

// Simple test that should output something
test('direct test', function(t) {
  console.log('Running direct test');
  t.is(1 + 1, 2, '1 + 1 should equal 2');
});
