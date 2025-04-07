import test from 'brittle';

test('simple test', function(t) {
  console.log('Running simple test');
  t.is(1 + 1, 2, '1 + 1 should equal 2');
});
