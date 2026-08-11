import QtQuick
import QtTest

TestCase {
    name: "QualityFixture"

    function test_arithmetic(): void {
        compare(40 + 2, 42);
    }
}
