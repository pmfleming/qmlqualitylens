#include <QGuiApplication>
#include <QQmlComponent>
#include <QQmlEngine>
#include <QQuickItem>
#include <QQuickWindow>
#include <QTimer>
#include <QDebug>
#include <memory>
#include <cstdio>

int main(int argc, char **argv)
{
    QGuiApplication app(argc, argv);
    QQmlEngine engine;
    engine.addImportPath(QStringLiteral(FIXTURE_QML_IMPORT_PATH));
    QQuickWindow window;
    QQmlComponent component(&engine);
    component.setData("import QmlQualityLens.Fixture 1.0\nMain { title: \"Smoke fixture\" }", QUrl());
    std::unique_ptr<QObject> root(component.create());
    auto *item = qobject_cast<QQuickItem *>(root.get());
    if (!item || root->property("answer").toInt() != 42) {
        qCritical() << "Fixture QML module failed to load:" << component.errors();
        return 1;
    }
    window.resize(320, 200);
    item->setParentItem(window.contentItem());
    window.show();
    QTimer::singleShot(150, &app, [&]() {
        std::puts("qmlqualitylens compiled Qt smoke passed");
        app.quit();
    });
    return app.exec();
}
