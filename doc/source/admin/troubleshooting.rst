Troubleshooting Caldaver
=======================

If you are having problems with Caldaver, check you have met all the
requisites and search Caldaver logs/web server logs for error lines.

You can write to `Caldaver general list
<http://groups.google.com/group/caldaver-general>`_ asking for help. Make
sure you include the following information:

* Software details (OS, Caldaver version, deployment method, CalDAV server)
* Clear description of your problem
* Important log lines

Try the following before writing:

.. _development_environment:

Development environment
-----------------------

You can switch to ``development`` environment easily by setting the environment
variable ``CALDAVER_ENVIRONMENT`` to ``dev``.

Environment variables are provided by your process manager, shell, container
runtime, or orchestration platform. For local debugging, run the Rust server
directly and set ``RUST_LOG=caldaver_server=debug,tower_http=debug``.

Debug your browser status
-------------------------

Most browsers can show you network activity and JavaScript errors using its
own interfaces. They can be very handful if you happen to find a bug on
Caldaver. Some examples of browser which include this support are:

* Mozilla Firefox with Firebug extension
* Google Chrome/Chromium with Developer Tools (no addon required)
