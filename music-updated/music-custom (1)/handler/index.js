const fs = require("fs");
const path = require("path");

module.exports = async (client) => {
    const commandsPath = path.join(process.cwd(), "commands");
    const commandFolders = fs.readdirSync(commandsPath);

    commandFolders.forEach((folder) => {
        const folderPath = path.join(commandsPath, folder);
        const commandFiles = fs.readdirSync(folderPath).filter(file => file.endsWith(".js"));

        commandFiles.forEach((file) => {
            const filePath = path.join(folderPath, file);
            const command = require(filePath);
            if (command.name) {
                client.commands.set(command.name, { directory: folder, ...command });
            }
        });
    });

    const eventsPath = path.join(process.cwd(), "handler");
    const eventFiles = fs.readdirSync(eventsPath).filter(file => file.endsWith(".js"));

    eventFiles.forEach((file) => {
        const filePath = path.join(eventsPath, file);
        const event = require(filePath);
        if (event.once) {
            client.once(event.name, (...args) => event.execute(...args, client));
        } else {
            client.on(event.name, (...args) => event.execute(...args, client));
        }
    });
};
