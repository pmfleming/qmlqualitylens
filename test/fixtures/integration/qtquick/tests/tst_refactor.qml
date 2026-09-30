import QtQuick
import QtTest

// Agent-authored behavior candidates, pending independent intent/ranking review.
TestCase {
    name: "RefactorBehavior"

    function before(value: real): real {
        if (value < 0)
            return 0;
        if (value > 10)
            return 10;
        return value;
    }

    function equivalent(value: real): real {
        return value < 0 ? 0 : value > 10 ? 10 : value;
    }

    function incorrectSmaller(value: real): real {
        return Math.min(10, Math.max(0, value));
    }

    function test_preserves_sampled_behavior() {
        const values = [-Infinity, -11, -1, -0, 0, 1, 9, 10, 11, Infinity, NaN];
        for (const value of values)
            verify(Object.is(before(value), equivalent(value)));
    }

    function test_smaller_is_not_equivalent() {
        verify(Object.is(before(-0), -0));
        verify(!Object.is(incorrectSmaller(-0), -0));
    }
}
