# metamodel-to-doc
Generates a simple bootstrap, SEO friendly static website for VAPI documentation.

Install:

    $ cd metamodel-to-doc
    $ npm install

Example usage:

    $ node index.js -t layer1 -o ~/Sites/vapi -p ./templates/

    $ node index.js --help

    Usage: index [options]


    Options:

        -V, --version                        output the version number
        -t, --testbed <testbed>              testbed
        -o, --output_path <output_path>      output path, defaults to ./reference/
        -p, --template_path <template_path>  template path, defaults to ./templates/
        -h, --help                           output usage information
