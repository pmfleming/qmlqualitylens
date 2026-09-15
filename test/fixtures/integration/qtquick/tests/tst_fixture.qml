import QtQuick
import QtTest
import QmlQualityLens.Fixture 1.0 as Fixture

TestCase {
    id: testCase

    name: "QualityFixture"

    Component {
        id: fixtureComponent

        Fixture.Main {
            title: qsTr("Test fixture")
        }
    }

    function test_built_module(): void {
        const item = createTemporaryObject(fixtureComponent, testCase);
        verify(item !== null);
        compare(item.answer, 42);
        compare(item.title, "Test fixture");
        compare(item.width, 320);
    }
}
