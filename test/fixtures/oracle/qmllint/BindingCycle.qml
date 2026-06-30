import QtQuick 2.15

Item {
    Item {
        id: a
        width: b.width
    }

    Item {
        id: b
        width: a.width
    }
}
