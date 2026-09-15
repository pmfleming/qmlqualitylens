include_guard(GLOBAL)
include(CMakeParseArguments)

# Adds an explicit (not ALL) audit target. Use a static/import-only config to
# avoid recursively configuring/building/testing the calling project.
# qmlqualitylens_add_target(NAME qml_quality CONFIG path/to/lens.json
#                          [NODE_EXECUTABLE node] [CLI path/to/qmlqualitylens.js]
#                          [DEPENDS app other_target])
function(qmlqualitylens_add_target)
    cmake_parse_arguments(PARSE_ARGV 0 LENS "" "NAME;CONFIG;NODE_EXECUTABLE;CLI" "DEPENDS")
    if(LENS_UNPARSED_ARGUMENTS OR LENS_KEYWORDS_MISSING_VALUES)
        message(FATAL_ERROR "Invalid qmlqualitylens_add_target arguments: ${LENS_UNPARSED_ARGUMENTS};${LENS_KEYWORDS_MISSING_VALUES}")
    endif()
    if(NOT LENS_NAME)
        set(LENS_NAME qmlqualitylens)
    endif()
    if(NOT LENS_CONFIG)
        set(LENS_CONFIG "${CMAKE_CURRENT_SOURCE_DIR}/qmlqualitylens.config.json")
    endif()
    get_filename_component(LENS_CONFIG "${LENS_CONFIG}" ABSOLUTE BASE_DIR "${CMAKE_CURRENT_SOURCE_DIR}")
    if(NOT EXISTS "${LENS_CONFIG}")
        message(FATAL_ERROR "qmlqualitylens config does not exist: ${LENS_CONFIG}")
    endif()
    if(NOT LENS_NODE_EXECUTABLE)
        find_program(LENS_NODE_EXECUTABLE NAMES node nodejs REQUIRED)
    endif()
    if(NOT LENS_CLI)
        get_filename_component(LENS_CLI "${CMAKE_CURRENT_FUNCTION_LIST_DIR}/../dist/bin/qmlqualitylens.js" ABSOLUTE)
    else()
        get_filename_component(LENS_CLI "${LENS_CLI}" ABSOLUTE BASE_DIR "${CMAKE_CURRENT_SOURCE_DIR}")
    endif()
    if(NOT EXISTS "${LENS_CLI}")
        message(FATAL_ERROR "qmlqualitylens CLI not found: ${LENS_CLI}. Build the source checkout with npm run build, or use an installed package.")
    endif()
    add_custom_target(${LENS_NAME}
        COMMAND "${CMAKE_COMMAND}" -E env QMLQUALITYLENS_IN_CMAKE=1
            "${LENS_NODE_EXECUTABLE}" "${LENS_CLI}" audit
            --config "${LENS_CONFIG}" --incomplete fail --format markdown
        DEPENDS ${LENS_DEPENDS}
        WORKING_DIRECTORY "${CMAKE_CURRENT_SOURCE_DIR}"
        COMMENT "Auditing QML quality (${LENS_NAME})"
        USES_TERMINAL
        VERBATIM
    )
endfunction()
