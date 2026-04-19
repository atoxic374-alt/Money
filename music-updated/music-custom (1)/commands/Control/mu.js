const fs = require('fs');
const { Client, GatewayIntentBits, ActionRowBuilder, StringSelectMenuBuilder, ButtonBuilder, EmbedBuilder, ComponentType } = require('discord.js');
const { owners, prefix, Colors } = require(`${process.cwd()}/settings/config`);
const axios = require("axios");
const db = require('pro.db');
const Discord = require('discord.js');
const path = require('path');

module.exports = {
    name: 'music',
    aliases: ["mu", "vip"],
    async execute(client, message, args) {


        let targetUser = message.mentions.users.first();

        if (targetUser && !owners.includes(message.author.id)) {
            return;
        }

        if (!targetUser) {
            targetUser = message.author;
        }

        let subscriptions = [];
        try {
            const data = fs.readFileSync('./settings/time.json', 'utf8');
            subscriptions = JSON.parse(data);
        } catch (error) {
            return;
        }
        const userId = targetUser.id;
        const userSubscriptions = subscriptions.filter(sub => sub.user === targetUser.id);

        if (userSubscriptions.length === 0) {
            return;
        }

        const emojiData = JSON.parse(fs.readFileSync('./settings/emojis.json', 'utf8'));
        const emojis = emojiData.emojis;

        const selectMenu = new Discord.StringSelectMenuBuilder()
            .setCustomId('subscriptionCodes')
            .setPlaceholder('يرجى الاختيار ..')
            .setMinValues(1)
            .addOptions(userSubscriptions.map((sub, index) => {
                return {
                    label: `Music x${sub.botsCount} `,
                    emoji: emojis[index],
                    description: `(SuID ${sub.code})`,
                    value: sub.code
                };
            }));

        const cancelButton = new ButtonBuilder()
            .setCustomId('cancel')
            .setLabel('إلغاء')
            .setStyle('Danger');

        const row = new ActionRowBuilder().addComponents(selectMenu);
        const row2 = new ActionRowBuilder().addComponents(cancelButton);

        const panelMsg = await message.reply({
            content: '**أختر الأشتراك.**',
            components: [row, row2]
        });


        // مهم جداً: اجمع التفاعلات على نفس الرسالة فقط (مو على الروم كامل)
        // لأن جمعها على الروم يسبب وجود أكثر من Collector يلتقط نفس التفاعل
        // وبالتالي تحصل أخطاء 40060 / 10062.
        const filter = (i) => i.user.id === message.author.id;
        const collector = panelMsg.createMessageComponentCollector({ filter, time: 60000 });


        collector.on('collect', async (interaction) => {
            // زر الإلغاء
            if (interaction.isButton() && interaction.customId === 'cancel') {
                await interaction.deferUpdate().catch(() => {});
                await interaction.message.delete().catch(() => {});
                collector.stop('cancel');
                return;
            }

            // نتأكد أن هذا الاختيار هو الخاص بالقائمة الأولى فقط
            if (!interaction.isStringSelectMenu() || interaction.customId !== 'subscriptionCodes') return;

            // وقف الـ collector قبل أي تحديث لتجنب تكرار الاعتراف بالتفاعل
            collector.stop('selected');

            const selectedCodes = interaction.values;
            const selectedSubscriptions = userSubscriptions.filter(sub => selectedCodes.includes(sub.code));

            if (selectedSubscriptions.length > 0) {
                if (!fs.existsSync('./settings/tokens.json')) {
                    return;
                }

                let tokens = [];
                try {
                    const tokensData = fs.readFileSync('./settings/tokens.json', 'utf8');
                    tokens = JSON.parse(tokensData);
                } catch (error) {
                    console.error('حدث خطأ أثناء قراءة الملف tokens.json:', error);
                    return;
                }

                const userTokens = tokens.filter(token => selectedCodes.includes(token.code) && token.client === targetUser.id);

                const totalBots = userTokens.length;

                const selectMenu = new StringSelectMenuBuilder()
                    .setCustomId('vipOptions')
                    .setPlaceholder('يرجى الاختيار ..')
                    .addOptions([
                        {
                            label: 'اشتراك',
                            emoji: '1265309996292378756',
                            description: 'لعرض مُدة اشتراكك المتبقية',
                            value: 'musictime',
                        }, {
                            label: 'إعادة تشغيل',
                            emoji: '1356528848237367326',
                            description: 'إعادة تشغيل البوتات المملوكة لك جميعًا',
                            value: 'restart',
                        },
                        {
                            label: 'إدارة مظهر البوتات',
                            emoji: '1256869689015926845',
                            description: 'تغير مظهر واسماء جميع البوتات التي تمتكلها',
                            value: 'appearance',
                        }, {
                            label: 'إدارة السيرفرات',
                            emoji: '1256869694967644231',
                            description: 'نقل سيرفر البوتات إلي سيرفر جديد',
                            value: 'updateServerId',
                        },
                        {
                            label: 'نقل ملكية البوتات',
                            emoji: '1344186014448615435',
                            description: 'نقل ملكية البوتات إلى مستخدم آخر',
                            value: 'transferOwnership',
                        },
                        {
                            label: 'تثبيت البوتات',
                            emoji: '1344186548350095381',
                            description: 'تثبيت جميع البوتات التي تمتلكها اليوم مُحدد',
                            value: 'installBot',
                        }, {
                            label: 'روابط البوتات',
                            emoji: '1256869691004162068',
                            description: 'احصل علي روابك جميع برامج البوتات التي تمتكلها',
                            value: 'mylinks',
                        }, {
                            label: 'منصة التشغيل',
                            emoji: '1344144928967757897',
                            description: 'من أجل أختيار منصة التشغيل الاساسية لبدء التشغيل',
                            value: 'platform',
                        }
                    ]);

                const cancelButton = new ButtonBuilder()
                    .setCustomId('cancel')
                    .setLabel('إلغاء')
                    .setStyle('Danger');

                const replyMessage = await interaction.update({
                    content: `**عـدد بـُوتـاتـك :** \`${totalBots}\``,
                    components: [
                        new ActionRowBuilder().addComponents(selectMenu),
                        new ActionRowBuilder().addComponents(cancelButton)
                    ]
                });

                const filter = (i) => i.user.id === message.author.id;
                const collector = replyMessage.createMessageComponentCollector({ filter, time: 60000 });

                collector.on('collect', async (interaction) => {
                    // زر الإلغاء
                    if (interaction.isButton() && interaction.customId === 'cancel') {
                        await interaction.deferUpdate().catch(() => {});
                        await interaction.message.delete().catch(() => {});
                        collector.stop('cancel');
                        return;
                    }

                    // نتأكد أن هذه القائمة هي قائمة الخيارات
                    if (!interaction.isStringSelectMenu() || interaction.customId !== 'vipOptions') return;

                    collector.stop('selected');
                    const selectedOption = interaction.values[0];

                    if (selectedOption === 'mylinks') {


                        const selectMenu = new StringSelectMenuBuilder()
                            .setCustomId('vipOptions')
                            .setPlaceholder('يرجى الاختيار ..')
                            .addOptions([
                                {
                                    label: 'روابط',
                                    emoji: '1264908026679136360',
                                    description: 'إرسال جميع روابط البوتات التي تمتكلها',
                                    value: 'allBotsLinks',
                                }, {
                                    label: 'روابط خارج السيرفر',
                                    emoji: '1264908028369702935',
                                    description: 'إرسال جميع روابط البوتات خارج سيرفرك',
                                    value: 'Off-serverlinks',
                                }
                            ]);

                        const cancelButton = new ButtonBuilder()
                            .setCustomId('cancel')
                            .setLabel('إلغاء')
                            .setStyle('Danger');

                        const replyMessage = await interaction.update({
                            content: `**أخـتـر الأمـر.**`,
                            components: [
                                new ActionRowBuilder().addComponents(selectMenu),
                                new ActionRowBuilder().addComponents(cancelButton)
                            ]
                        });

						const filter = (i) => i.user.id === message.author.id;
						const collector = replyMessage.createMessageComponentCollector({ filter, time: 60000 });

						collector.on('collect', async (interaction) => {
							// زر الإلغاء
							if (interaction.isButton() && interaction.customId === 'cancel') {
								await interaction.deferUpdate().catch(() => {});
								await interaction.message.delete().catch(() => {});
								collector.stop('cancel');
								return;
							}

							if (!interaction.isStringSelectMenu() || interaction.customId !== 'vipOptions') return;
							const selectedOption = interaction.values[0];
                            if (selectedOption === 'allBotsLinks') {
                                const lastClaimTime = await db.get(`linktime_${message.author.id}`) || 0;
                                const currentTime = Date.now();
                                const timeDifference = currentTime - lastClaimTime;

                                if (timeDifference < 240000) {
                                    const remainingTime = 240000 - timeDifference;
                                    const minutes = Math.floor(remainingTime / (1000 * 60));
                                    const seconds = Math.ceil((remainingTime % (1000 * 60)) / 1000);

                                    const formattedTime = `${minutes < 10 ? '0' : ''}${minutes}:${seconds < 10 ? '0' : ''}${seconds}`;

                                    if (!interaction.replied && !interaction.deferred) {
                                        interaction.message.delete();
                                        return message.reply({ content: `⌛ يجب أن تنتظر ${formattedTime} قبل إستخدام هذا الأمر مرة أخرى` });
                                    }
                                    return;
                                }

                                await interaction.deferUpdate();

                                let totalBots = userTokens.length;

                                let botInfoPromises = [];
                                for (let [index, token] of userTokens.entries()) {
                                    const botIntents = [
                                        GatewayIntentBits.Guilds,
                                        GatewayIntentBits.GuildVoiceStates,
                                        GatewayIntentBits.GuildMessages,
                                        GatewayIntentBits.MessageContent,
                                    ];
                                    const bot = new Client({ intents: botIntents });

                                    botInfoPromises.push(new Promise(async (resolve, reject) => {
                                        try {
                                            await bot.login(token.token);
                                            const botInfo = `\`${bot.user?.username || "غير معروف"}\` https://discord.com/api/oauth2/authorize?client_id=${bot.user?.id}&permissions=0&scope=bot`;
                                            resolve(botInfo);
                                        } catch (err) {
                                            reject(err);
                                        }
                                    }));
                                }

                                Promise.all(botInfoPromises)
                                    .then(botInfos => {
                                        botInfos.forEach((botInfo, index) => {
                                            interaction.user.send(`**🔗 : رابط بوت الميوزك رقم ${index + 1} :**\n${botInfo}`)
                                                .catch((err) => {
                                                    console.error("حدث خطأ أثناء إرسال الرابط:", err);
                                                });
                                        });

                                        const disabledComponents = interaction.message.components.map(row => {
                                            return new ActionRowBuilder().addComponents(
                                                row.components.map(component => {
                                                    if (component.type === ComponentType.Button) {
                                                        return ButtonBuilder.from(component).setDisabled(true);
                                                    } else if (component.type === ComponentType.StringSelect) {
                                                        return StringSelectMenuBuilder.from(component).setDisabled(true);
                                                    } else {
                                                        return component;
                                                    }
                                                })
                                            );
                                        });

                                        db.set(`linktime_${message.author.id}`, currentTime);

                                        interaction.followUp({ content: `تم إرسال **${totalBots}** من الروابط إلى الخاص.` });
                                        interaction.editReply({ components: disabledComponents });
                                    })
                                    .catch(err => {
                                        console.error("حدث خطأ أثناء جمع روابط البوتات:", err);
                                        interaction.followUp({ content: `\`\`\`.حدث خطأ، يرجى التواصل مع الدعم الفني\`\`\`` });
                                        interaction.editReply({ components: disabledComponents });

                                    });
                            } else if (selectedOption === 'Off-serverlinks') {

                                const lastClaimTime = await db.get(`Off-serverlinks-${message.author.id}`) || 0;
                                const currentTime = Date.now();
                                const timeDifference = currentTime - lastClaimTime;

                                if (timeDifference < 240000) {
                                    const remainingTime = 240000 - timeDifference;
                                    const minutes = Math.floor(remainingTime / (1000 * 60));
                                    const seconds = Math.ceil((remainingTime % (1000 * 60)) / 1000);

                                    const formattedTime = `${minutes < 10 ? '0' : ''}${minutes}:${seconds < 10 ? '0' : ''}${seconds}`;

                                    if (!interaction.replied && !interaction.deferred) {
                                        interaction.message.delete();
                                        return message.reply({ content: `⌛ يجب أن تنتظر ${formattedTime} قبل إستخدام هذا الأمر مرة أخرى` });
                                    }
                                    return;
                                }

                                await interaction.deferUpdate();


                                let totalBots = userTokens.length;
                                let totalSentBots = 0;
                                let botInfoPromises = [];

                                for (let [index, token] of userTokens.entries()) {
                                    const botIntents = [
                                        GatewayIntentBits.Guilds,
                                        GatewayIntentBits.GuildVoiceStates,
                                        GatewayIntentBits.GuildMessages,
                                        GatewayIntentBits.MessageContent,
                                    ];
                                    const bot = new Client({ intents: botIntents });

                                    botInfoPromises.push(new Promise(async (resolve, reject) => {
                                        try {
                                            await bot.login(token.token);
                                            const serverId = token.Server;
                                            const guild = bot.guilds.cache.get(serverId);

                                            if (!guild) {
                                                const botInfo = `\`${bot.user?.username || "غير معروف"}\` https://discord.com/api/oauth2/authorize?client_id=${bot.user?.id}&permissions=0&scope=bot`;
                                                resolve(botInfo);
                                            } else {
                                                resolve(null);
                                            }
                                        } catch (err) {
                                            reject(err);
                                        }
                                    }));
                                }

                                Promise.all(botInfoPromises)
                                    .then(botInfos => {
                                        botInfos.forEach((botInfo, index) => {
                                            if (botInfo) {
                                                interaction.user.send(`**🔗 : رابط بوت الميوزك رقم ${index + 1} :**\n${botInfo}`)
                                                    .catch((err) => {
                                                        console.error("حدث خطأ أثناء إرسال الرابط:", err);
                                                    });
                                                totalSentBots++;
                                            }
                                        });

                                        db.set(`Off-serverlinks-${message.author.id}`, currentTime);

                                        const disabledComponents = interaction.message.components.map(row => {
                                            return new ActionRowBuilder().addComponents(
                                                row.components.map(component => {
                                                    if (component.type === ComponentType.Button) {
                                                        return ButtonBuilder.from(component).setDisabled(true);
                                                    } else if (component.type === ComponentType.StringSelect) {
                                                        return StringSelectMenuBuilder.from(component).setDisabled(true);
                                                    } else {
                                                        return component;
                                                    }
                                                })
                                            );
                                        });


                                        if (totalSentBots > 0) {
                                            interaction.followUp({ content: `تم إرسال **${totalSentBots}** من الروابط إلى الخاص.` });
                                            interaction.editReply({ components: disabledComponents });

                                        } else {
                                            interaction.followUp({ content: `جميع البوتات موجودة بالسيرفر بالفعل.` });
                                            interaction.editReply({ components: disabledComponents });
                                        }
                                    })
                                    .catch(err => {
                                        console.error("حدث خطأ أثناء جمع روابط البوتات:", err);
                                        interaction.followUp({ content: `\`\`\`.حدث خطأ، يرجى التواصل مع الدعم الفني\`\`\`` });
                                        interaction.editReply({ components: disabledComponents });

                                    });
                            }


                        });


                        collector.on('end', (collected, reason) => {
                            if (reason === 'time') {
                            }
                        });


                    }
                    else if (selectedOption === 'appearance') {

                        const selectMenu = new StringSelectMenuBuilder()
                            .setCustomId('vipOptions')
                            .setPlaceholder('يرجى الاختيار ..')
                            .addOptions([
                                {
                                    label: 'تبديل الأزرار',
                                    emoji: '1264914466852700211',
                                    description: 'تعطيل او تفعيل الأزرار',
                                    value: 'editbuttons',
                                }, {

                                    label: 'تغير الحالة',
                                    emoji: '1344209274951438398',
                                    description: 'تغير حالة جميع بوتاتك',
                                    value: 'condition',
                                },
                                {
                                    label: 'تغير صور',
                                    emoji: '1251777625509068871',
                                    description: 'تغير صور جميع بوتاتك',
                                    value: 'editavatar',
                                }, {
                                    label: 'تغير بنر',
                                    emoji: '1258322362550718575',
                                    description: 'تغير بنر جميع بوتاتك',
                                    value: 'editbanners',
                                }, {
                                    label: 'تغير أسم',
                                    emoji: '1251797972082229268',
                                    description: 'تغير اسم جميع بوتاتك',
                                    value: 'editname',
                                }
                            ]);

                        const cancelButton = new ButtonBuilder()
                            .setCustomId('cancel')
                            .setLabel('إلغاء')
                            .setStyle('Danger');

                        const replyMessage = await interaction.update({
                            content: `**أخـتـر الأشـتـراك**`,
                            components: [
                                new ActionRowBuilder().addComponents(selectMenu),
                                new ActionRowBuilder().addComponents(cancelButton)
                            ]
                        });

						const filter = (i) => i.user.id === message.author.id;
						const collector = replyMessage.createMessageComponentCollector({ filter, time: 60000 });

						collector.on('collect', async (interaction) => {
							// زر الإلغاء
							if (interaction.isButton() && interaction.customId === 'cancel') {
								await interaction.deferUpdate().catch(() => {});
								await interaction.message.delete().catch(() => {});
								collector.stop('cancel');
								return;
							}

							if (!interaction.isStringSelectMenu() || interaction.customId !== 'vipOptions') return;
							const selectedOption = interaction.values[0];

                            if (selectedOption === 'editbuttons') {

                                const lastClaimTime = await db.get(`editbuttons_${message.author.id}`) || 0;
                                const currentTime = Date.now();
                                const timeDifference = currentTime - lastClaimTime;

                                if (timeDifference < 240000) {
                                    const remainingTime = 240000 - timeDifference;
                                    const minutes = Math.floor(remainingTime / (1000 * 60));
                                    const seconds = Math.ceil((remainingTime % (1000 * 60)) / 1000);

                                    const formattedTime = `${minutes < 10 ? '0' : ''}${minutes}:${seconds < 10 ? '0' : ''}${seconds}`;

                                    if (!interaction.replied && !interaction.deferred) {
                                        interaction.message.delete();
                                        return message.reply({ content: `⌛ يجب أن تنتظر ${formattedTime} قبل إستخدام هذا الأمر مرة أخرى` });
                                    }
                                    return;
                                }

                                await interaction.deferUpdate();

                                const currentTokenData = tokens.filter(token => token.client === userId);

                                const newButtonState = currentTokenData[0].buttons === 'on' ? 'off' : 'on';
                                currentTokenData.forEach(tokenData => {
                                    tokenData.buttons = newButtonState;
                                });


                                const disabledComponents = interaction.message.components.map(row => {
                                    return new ActionRowBuilder().addComponents(
                                        row.components.map(component => {
                                            if (component.type === ComponentType.Button) {
                                                return ButtonBuilder.from(component).setDisabled(true);
                                            } else if (component.type === ComponentType.StringSelect) {
                                                return StringSelectMenuBuilder.from(component).setDisabled(true);
                                            } else {
                                                return component;
                                            }
                                        })
                                    );
                                });

                                try {
                                    fs.writeFileSync('./settings/tokens.json', JSON.stringify(tokens, null, 2), 'utf8');
                                    const botCount = currentTokenData.length;
                                    db.set(`editbuttons_${message.author.id}`, currentTime);
                                    await interaction.followUp({ content: `تم ${newButtonState === 'on' ? 'تفعيل' : 'إيقاف'} جميع الازرار لبوتات الميوزك بنجاح، البوتات المتأثرة : **${botCount}**` });
                                    interaction.editReply({ components: disabledComponents });

                                } catch (error) {
                                    console.error('حدث خطأ أثناء تحديث ملف التوكنات:', error);
                                    await interaction.followUp({ content: '```.حدث خطأ أثناء تحديث الأزرار، يرجى التواصل مع الدعم الفني```' });
                                    interaction.editReply({ components: disabledComponents });
                                }



                            }



                            if (selectedOption === 'editavatar') {

                                const lastClaimTime = await db.get(`editavatar_${message.author.id}`) || 0;
                                const currentTime = Date.now();
                                const timeDifference = currentTime - lastClaimTime;

                                if (timeDifference < 240000) {
                                    const remainingTime = 240000 - timeDifference;
                                    const minutes = Math.floor(remainingTime / (1000 * 60));
                                    const seconds = Math.ceil((remainingTime % (1000 * 60)) / 1000);

                                    const formattedTime = `${minutes < 10 ? '0' : ''}${minutes}:${seconds < 10 ? '0' : ''}${seconds}`;

                                    if (!interaction.replied && !interaction.deferred) {
                                        interaction.message.delete();
                                        return message.reply({ content: `⌛ يجب أن تنتظر ${formattedTime} قبل إستخدام هذا الأمر مرة أخرى` });
                                    }
                                    return;
                                }

                                const avatarsend = `<@${interaction.user.id}> - يرجى إرفاق الصورة الجديدة، ملاحظة: يجب أن تكون الصورة مرفقة كـ صورة وليس رابط وأن يكون حجم الصورة أقل من 10 ميغابايت`;

                                const cancelButton = new ButtonBuilder()
                                    .setCustomId('cancel')
                                    .setLabel('إلغاء')
                                    .setStyle('Danger');

                                const actionRow = new ActionRowBuilder().addComponents(cancelButton);

                                await interaction.update({ content: avatarsend, components: [actionRow] });

                                const filter = (message) => message.author.id === interaction.user.id && message.attachments.size > 0;
                                const messageCollector = interaction.channel.createMessageCollector({ filter, time: 60000 });

                                let changedBotCount = 0;

                                messageCollector.on('collect', async (message) => {
                                    const imageUrl = message.attachments.first().url;

                                    for (const tokenData of userTokens) {
                                        const botIntents = [
                                            GatewayIntentBits.Guilds,
                                            GatewayIntentBits.GuildVoiceStates,
                                            GatewayIntentBits.GuildMessages,
                                            GatewayIntentBits.MessageContent,
                                        ];
                                        const bot = new Client({ intents: botIntents });

                                        try {
                                            await bot.login(tokenData.token);
                                            await bot.user.setAvatar(imageUrl);
                                            changedBotCount++;
                                            await bot.destroy();
                                        } catch (err) {
                                            console.error(`حدث خطأ أثناء تغيير صورة البوت: ${bot.user?.username || "غير معروف"} - ${err.message}`);
                                        }
                                    }

                                    try {
                                        await interaction.editReply({ content: `تم تغيير صور جميع البوتات بنجاح، البوتات المتأثرة: **${changedBotCount}**`, components: [] });
                                    } catch (error) {
                                        console.error('Error editing reply:', error);
                                    }
                                    db.set(`editavatar_${message.author.id}`, currentTime);
                                    await message.delete();
                                    messageCollector.stop();
                                });


                                messageCollector.on('end', async (collected) => {
                                    if (collected.size === 0) {
                                        await interaction.editReply({ content: "**أنـتـهى وقـت الأرسـال ⏳.**", components: [] });
                                    }
                                });

                            } else if (selectedOption === 'editname') {

                                const lastClaimTime = await db.get(`nametime_${message.author.id}`) || 0;
                                const currentTime = Date.now();
                                const timeDifference = currentTime - lastClaimTime;

                                if (timeDifference < 240000) {
                                    const remainingTime = 240000 - timeDifference;
                                    const minutes = Math.floor(remainingTime / (1000 * 60));
                                    const seconds = Math.ceil((remainingTime % (1000 * 60)) / 1000);

                                    const formattedTime = `${minutes < 10 ? '0' : ''}${minutes}:${seconds < 10 ? '0' : ''}${seconds}`;

                                    if (!interaction.replied && !interaction.deferred) {
                                        interaction.message.delete();
                                        return message.reply({ content: `⌛ يجب أن تنتظر ${formattedTime} قبل إستخدام هذا الأمر مرة أخرى` });
                                    }
                                    return;
                                }

                                const nameChangePrompt = `<@${interaction.user.id}> - يرجى إدخال الاسم الجديد الذي تريده للبوتات`;

                                const cancelButton = new ButtonBuilder()
                                    .setCustomId('cancel')
                                    .setLabel('إلغاء')
                                    .setStyle('Danger');

                                const actionRow = new ActionRowBuilder().addComponents(cancelButton);

                                await interaction.update({ content: nameChangePrompt, components: [actionRow] });

                                const filter = (message) => message.author.id === interaction.user.id;
                                const messageCollector = interaction.channel.createMessageCollector({ filter, time: 60000 });

                                let changedBotCount = 0;
                                let failedBotCount = 0;

                                messageCollector.on('collect', async (message) => {
                                    const newName = message.content.trim();

                                    for (const tokenData of userTokens) {
                                        const botIntents = [
                                            GatewayIntentBits.Guilds,
                                            GatewayIntentBits.GuildVoiceStates,
                                            GatewayIntentBits.GuildMessages,
                                            GatewayIntentBits.MessageContent,
                                        ];
                                        const bot = new Client({ intents: botIntents });

                                        try {
                                            await bot.login(tokenData.token);
                                            await bot.user.setUsername(newName);
                                            changedBotCount++;
                                            await bot.destroy();
                                        } catch (err) {
                                            console.error(`حدث خطأ أثناء تغيير اسم البوت: ${bot.user?.username || "غير معروف"} - ${err.message}`);

                                            if (err.message.includes('USERNAME_RATE_LIMIT')) {
                                                failedBotCount++;
                                            }
                                        }
                                    }

                                    if (changedBotCount === 0) {
                                        await interaction.editReply({ content: 'حدث خطأ، لا يمكنك تغيير أسماء بعض البوتات في الوقت الحالي حاول لاحقًا.', components: [] });
                                    } else {
                                        if (changedBotCount > 0 && failedBotCount > 0) {
                                            await interaction.editReply({
                                                content: `تم تغيير أسماء بعض البوتات بنجاح، البوتات المتأثرة: **${changedBotCount}** من أصل **${userTokens.length}**.`,
                                                components: []
                                            });
                                        }
                                        else if (changedBotCount === userTokens.length) {
                                            await interaction.editReply({
                                                content: `تم تغيير أسماء جميع البوتات بنجاح، البوتات المتأثرة: **${changedBotCount}**.`,
                                                components: []
                                            });
                                        }
                                    }

                                    db.set(`editname_${message.author.id}`, currentTime);
                                    await message.delete();
                                    messageCollector.stop();
                                });


                                messageCollector.on('end', async (collected) => {
                                    if (collected.size === 0) {
                                        await interaction.editReply({ content: "**أنـتـهى وقـت الأرسـال ⏳.**", components: [] });
                                    }
                                });


                            }

                            if (selectedOption === 'editbanners') {

                                const lastClaimTime = await db.get(`bannerstime_${message.author.id}`) || 0;
                                const currentTime = Date.now();
                                const timeDifference = currentTime - lastClaimTime;

                                if (timeDifference < 240000) {
                                    const remainingTime = 240000 - timeDifference;
                                    const minutes = Math.floor(remainingTime / (1000 * 60));
                                    const seconds = Math.ceil((remainingTime % (1000 * 60)) / 1000);

                                    const formattedTime = `${minutes < 10 ? '0' : ''}${minutes}:${seconds < 10 ? '0' : ''}${seconds}`;

                                    if (!interaction.replied && !interaction.deferred) {
                                        interaction.message.delete()
                                        return message.reply({ content: `⌛ يجب أن تنتظر ${formattedTime} قبل إستخدام هذا الأمر مرة أخرى` });
                                    }
                                    return;
                                }

                                const bannersend = `<@${interaction.user.id}> - يرجى إرفاق الصورة الجديدة للبنر، ملاحظة: يجب أن تكون الصورة مرفقة كـ صورة وليس رابط وأن يكون حجم الصورة أقل من 10 ميغابايت`;

                                const cancelButton = new ButtonBuilder()
                                    .setCustomId('cancel')
                                    .setLabel('إلغاء')
                                    .setStyle('Danger');

                                const actionRow = new ActionRowBuilder().addComponents(cancelButton);

                                await interaction.update({ content: bannersend, components: [actionRow] });

                                const messageCollectorFilter = (message) => message.author.id === interaction.user.id && message.attachments.size > 0;
                                const messageCollector = interaction.channel.createMessageCollector({ filter: messageCollectorFilter, time: 60000 });

                                let changedBotCount = 0;

                                const changeBanner = async (imageUrl) => {
                                    for (const tokenData of userTokens) {
                                        try {
                                            const base64_banner_image = await axios.get(imageUrl, { responseType: 'arraybuffer' })
                                                .then((res) => Buffer.from(res.data, 'binary').toString('base64'));

                                            await axios.patch(`https://discord.com/api/v9/users/@me`, {
                                                banner: `data:image/jpeg;base64,${base64_banner_image}`
                                            }, {
                                                headers: {
                                                    'Authorization': `Bot ${tokenData.token}`
                                                }
                                            });

                                            changedBotCount++;
                                        } catch (err) {
                                            console.error(`حدث خطأ أثناء تغيير بنر البوت: ${err.message}`);
                                        }
                                    }
                                };

                                messageCollector.on('collect', async (message) => {
                                    const imageUrl = message.attachments.first()?.url;
                                    if (!imageUrl) {
                                        return;
                                    }

                                    await changeBanner(imageUrl);

                                    try {
                                        await interaction.editReply({ content: `تم تغيير بنر جميع البوتات بنجاح، البوتات المتأثرة : **${changedBotCount}**`, components: [] });
                                    } catch (error) {
                                        console.error('Error editing reply:', error);
                                    }
                                    db.set(`bannerstime_${message.author.id}`, currentTime);
                                    try {
                                        await message.delete();
                                    } catch (error) {
                                        console.error('Error deleting message:', error);
                                    }
                                    messageCollector.stop();
                                });


                                messageCollector.on('end', async (collected) => {
                                    if (collected.size === 0) {
                                        await interaction.editReply({ content: "**أنـتـهى وقـت الأرسـال ⏳.**", components: [] });
                                    }
                                });
                            }
                            if (selectedOption === 'condition') {


                                const last = await db.get(`statustime_${userId}`) || 0, now = Date.now();
                                if (now - last < 240000)
                                    return interaction.followUp({ content: `⌛`, ephemeral: true });
                                const sentMsg = await interaction.update({ content: `يَرجى أرفاق إسم الحالة الجديدة.`, ephemeral: false, components: [] });
                                const msgCollector = message.channel.createMessageCollector({ filter: m => m.author.id === message.author.id, time: 60000 });
                                msgCollector.on('collect', async (msg) => {
                                    const status = msg.content.trim();
                                    userTokens.forEach(t => t.status = status);
                                    fs.writeFileSync('./settings/tokens.json', JSON.stringify(tokens, null, 2));
                                    db.set(`statustime_${userId}`, now);
                                    msgCollector.stop();
                                    await sentMsg.edit({ content: `تم تغيير الحالة لـ **${userTokens.length}** بوت.` });
                                    await msg.react('✅');
                                });
                                msgCollector.on('end', c => { if (!c.size) sentMsg.edit({ content: "**أنـتـهى وقـت الأرسـال ⏳.**" }); });





                            }

                        });



                    } else if (selectedOption === 'changeBotNames') {

                        const lastClaimTime = await db.get(`nametime_${message.author.id}`) || 0;
                        const currentTime = Date.now();
                        const timeDifference = currentTime - lastClaimTime;

                        if (timeDifference < 240000) {
                            const remainingTime = 240000 - timeDifference;
                            const minutes = Math.floor(remainingTime / (1000 * 60));
                            const seconds = Math.ceil((remainingTime % (1000 * 60)) / 1000);

                            const formattedTime = `${minutes < 10 ? '0' : ''}${minutes}:${seconds < 10 ? '0' : ''}${seconds}`;

                            if (!interaction.replied && !interaction.deferred) {
                                interaction.message.delete()
                                return message.reply({ content: `⌛ يجب أن تنتظر ${formattedTime} قبل إستخدام هذا الأمر مرة أخرى` });
                            }
                            return;
                        }
                        const nameChangePrompt = `<@${interaction.user.id}> - يرجى إدخال الاسم الجديد الذي تريده للبوتات`;

                        const cancelButton = new ButtonBuilder()
                            .setCustomId('cancel')
                            .setLabel('إلغاء')
                            .setStyle('Danger');

                        const actionRow = new ActionRowBuilder().addComponents(cancelButton);

                        await interaction.update({ content: nameChangePrompt, components: [actionRow] });

                        const filter = (message) => message.author.id === interaction.user.id;
                        const messageCollector = interaction.channel.createMessageCollector({ filter, time: 70000 });

                        let changedBotCount = 0;

                        messageCollector.on('collect', async (message) => {
                            const newName = message.content.trim();

                            for (const tokenData of userTokens) {
                                const botGatewayIntentBits = new GatewayIntentBits([
                                    GatewayIntentBits.FLAGS.GUILDS,
                                    GatewayIntentBits.FLAGS.GUILD_MESSAGES,
                                    GatewayIntentBits.FLAGS.GUILD_MESSAGE_REACTIONS
                                ]);
                                const bot = new Client({ intents: botGatewayIntentBits });

                                try {
                                    await bot.login(tokenData.token);
                                    await bot.user.setUsername(newName);
                                    changedBotCount++;
                                    await bot.destroy();
                                } catch (err) {
                                    console.error(`حدث خطأ أثناء تغيير اسم البوت: ${bot.user?.username || "غير معروف"} - ${err.message}`);
                                }
                            }

                            try {
                                await interaction.editReply({ content: `تم تغيير أسماء جميع البوتات بنجاح، البوتات المتأثرة: **${changedBotCount}**`, components: [] });
                            } catch (error) {
                                console.error('Error editing reply:', error);
                            }
                            db.set(`nametime_${message.author.id}`, currentTime);
                            await message.delete();
                            messageCollector.stop();
                        });


                    }
                    else if (selectedOption === 'installBot') {
                        collector.stop();

                        const lastClaimTime = await db.get(`installBottime_${message.author.id}`) || 0;
                        const currentTime = Date.now();
                        const timeDifference = currentTime - lastClaimTime;

                        if (timeDifference < 240000) {
                            const remainingTime = 240000 - timeDifference;
                            const minutes = Math.floor(remainingTime / (1000 * 60));
                            const seconds = Math.ceil((remainingTime % (1000 * 60)) / 1000);

                            const formattedTime = `${minutes < 10 ? '0' : ''}${minutes}:${seconds < 10 ? '0' : ''}${seconds}`;

                            if (!interaction.replied && !interaction.deferred) {
                                if (interaction.message) {
                                    interaction.message.delete()
                                        .then(() => {
                                            message.reply({ content: `⌛ يجب أن تنتظر ${formattedTime} قبل استخدام هذا الأمر مرة أخرى` });
                                        })
                                        .catch(error => {
                                            console.error('Failed to delete message:', error);
                                        });
                                } else {
                                    console.error('Interaction message does not exist.');
                                }
                            }
                            return;
                        }

                        const cancelButton = new ButtonBuilder()
                            .setCustomId('cancel')
                            .setLabel('إلغاء')
                            .setStyle('Danger');

                        const actionRow = new ActionRowBuilder().addComponents(cancelButton);

                        const installBot = `<@${interaction.user.id}> - يرجى إرفاق ايدي الفويس المرغوب تثبيت البوتات به`;
                        await interaction.update({ content: installBot, components: [actionRow] });

                        const voiceIdFilter = (response) => {
                            return response.author.id === interaction.user.id && response.content.trim().length > 0;
                        };

                        const voiceIdCollector = interaction.channel.createMessageCollector({ filter: voiceIdFilter, time: 60000 });

                        let transferredBotCount = 0;

                        voiceIdCollector.on('collect', async (response) => {
                            const voiceId = response.content.trim();
                            for (const tokenData of userTokens) {
                                tokenData.channel = voiceId;
                                transferredBotCount++;
                            }
                            fs.writeFileSync('./settings/tokens.json', JSON.stringify(tokens, null, 2));

                            db.set(`installBottime_${message.author.id}`, currentTime);
                            await interaction.editReply({ content: `تم تحديث قناة الصوت لِـ **${transferredBotCount}** بوت بنجاح.`, components: [] });
                            response.delete();

                            voiceIdCollector.stop();
                        });

                        voiceIdCollector.on('end', async (collected) => {
                            if (collected.size === 0) {
                                await interaction.editReply({ content: "**أنـتـهى وقـت الأرسـال ⏳.**", components: [] });
                            }
                        });



                    } else if (selectedOption === 'updateServerId') {


                        const lastClaimTime = await db.get(`updateServerIdtime_${message.author.id}`) || 0;
                        const currentTime = Date.now();
                        const timeDifference = currentTime - lastClaimTime;

                        if (timeDifference < 240000) {
                            const remainingTime = 240000 - timeDifference;
                            const minutes = Math.floor(remainingTime / (1000 * 60));
                            const seconds = Math.ceil((remainingTime % (1000 * 60)) / 1000);

                            const formattedTime = `${minutes < 10 ? '0' : ''}${minutes}:${seconds < 10 ? '0' : ''}${seconds}`;

                            if (!interaction.replied && !interaction.deferred) {
                                if (interaction.message) {
                                    interaction.message.delete()
                                        .then(() => {
                                            message.reply({ content: `⌛ يجب أن تنتظر ${formattedTime} قبل استخدام هذا الأمر مرة أخرى` });
                                        })
                                        .catch(error => {
                                            console.error('Failed to delete message:', error);
                                        });
                                } else {
                                    console.error('Interaction message does not exist.');
                                }
                            }
                            return;
                        }



                        const cancelButton = new ButtonBuilder()
                            .setCustomId('cancel')
                            .setLabel('إلغاء')
                            .setStyle('Danger');


                        const acttionRow = new ActionRowBuilder().addComponents(cancelButton);
                        const serversend = `<@${interaction.user.id}> - يرجى إرفاق ايدي السيرفر المبغّى نقل البوتات به`;
                        await interaction.update({ content: serversend, components: [acttionRow] });

                        const serverIdFilter = (response) => {
                            return response.author.id === message.author.id && response.content.trim().length > 0;
                        };

                        const serverIdCollector = message.channel.createMessageCollector({ filter: serverIdFilter, time: 10000 });

                        serverIdCollector.on('collect', async (response) => {
                            const newServerId = response.content.trim();

                            if (!/^\d+$/.test(newServerId) || newServerId.length < 15) {
                                await interaction.editReply({ content: `\`\`\`يرجى إضافه ايدي سيرفر صحيح.\`\`\``, components: [] });
                                serverIdCollector.stop();
                                return;

                            }

                            for (const token of userTokens) {
                                token.Server = newServerId;
                            }
                            fs.writeFileSync('./settings/tokens.json', JSON.stringify(tokens, null, 2));

                            let botInfoPromises = [];
                            for (let [index, token] of userTokens.entries()) {
                                const botGatewayIntentBits = [
                                    GatewayIntentBits.Guilds,
                                    GatewayIntentBits.GuildMessages,
                                    GatewayIntentBits.GuildMessageReactions
                                ];

                                const bot = new Client({ intents: botGatewayIntentBits });

                                botInfoPromises.push(new Promise(async (resolve, reject) => {
                                    try {
                                        await bot.login(token.token);
                                        for (const guild of bot.guilds.cache.values()) {
                                            if (guild.id === newServerId) continue;
                                            if (guild.ownerId === bot.user.id) continue;

                                            try {
                                                await guild.leave();
                                            } catch (error) {
                                                console.error(`❌ > ${guild.id}:`, error.message);
                                            }
                                        }

                                        const botInviteLink = `https://discord.com/api/oauth2/authorize?client_id=${bot.user?.id}&permissions=0&scope=bot`;
                                        resolve(botInviteLink);
                                    } catch (err) {
                                        reject(err);
                                    }
                                }));
                            }

                            Promise.all(botInfoPromises)
                                .then(botInviteLinks => {
                                    const averageTimePerBot = 2000;
                                    const totalBots = botInviteLinks.length;
                                    const expectedTimeInSeconds = averageTimePerBot * totalBots / 1000;
                                    const expectedMinutes = Math.floor(expectedTimeInSeconds / 60);
                                    const expectedSeconds = Math.round(expectedTimeInSeconds % 60);

                                    botInviteLinks.forEach((botInviteLink, index) => {
                                        message.author.send(`**🔗 : رابط بوت الميوزك رقم ${index + 1}:**\n${botInviteLink}`)
                                            .catch(() => {
                                                console.error("حدث خطأ أثناء إرسال رابط البوت:", err);
                                            });
                                    });

                                    db.set(`updateServerIdtime_${message.author.id}`, currentTime);
                                    interaction.editReply({ content: `تم نقل **${totalBots}** بوت بنجاح. الوقت المتوقع لإرسال الروابط (\`${expectedMinutes}:${expectedSeconds < 10 ? '0' : ''}${expectedSeconds}\`) دقيقة تقريبًا`, components: [] });

                                })
                                .catch(err => {
                                    console.error("حدث خطأ أثناء تسجيل الدخول:", err);
                                    interaction.update({ content: `\`\`\`.حدث خطأ، يرجى التواصل مع الدعم الفني\`\`\``, components: [] });

                                });

                            await response.delete();
                            serverIdCollector.stop();
                        });



                    } else if (selectedOption === 'musictime') {
                        let userId;

                        if (message.mentions.users.size > 0) {
                            userId = message.mentions.users.first().id;
                        } else if (args[0]) {
                            userId = args[0];
                        } else {
                            userId = message.author.id;
                        }

                        try {
                            const logs = fs.readFileSync('./settings/time.json', 'utf8');
                            const logsArray = JSON.parse(logs);

                            const userSubscriptions = logsArray.filter(entry => entry.user === userId);

                            if (userSubscriptions.length === 0) {
                                return;
                            }

                            const embed = new EmbedBuilder()
                                .setColor(Colors)
                            let description = '';
                            userSubscriptions.forEach((userSubscription, index) => {
                                const expirationTime = userSubscription.expirationTime;
                                const remainingTime = expirationTime - Date.now();

                                const days = Math.floor(remainingTime / (1000 * 60 * 60 * 24));
                                const hours = Math.floor((remainingTime % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
                                const minutes = Math.floor((remainingTime % (1000 * 60 * 60)) / (1000 * 60));
                                const seconds = Math.floor((remainingTime % (1000 * 60)) / 1000);

                                const formattedTime = `${days ? `${days}d ` : ''}${hours ? `${hours}h ` : ''}${minutes ? `${minutes}m ` : ''}${seconds ? `${seconds}s` : ''}`;

                                description += `\`${index + 1}\` : \`Music x${userSubscription.botsCount} (SuID ${userSubscription.code})\` : \`${formattedTime}\`\n`;
                            });

                            embed.setDescription(description)
                                .setFooter({ text: `${message.client.user.username} | Timer`, iconURL: client.user.displayAvatarURL({ dynamic: true }) });

                            await interaction.update({ embeds: [embed], components: [], content: `\n\u200b` });

                        } catch (error) {
                            console.error('❌>', error);
                        }


                    } else if (selectedOption === 'transferOwnership') {




                        const cancelButton = new ButtonBuilder()
                            .setCustomId('cancel')
                            .setLabel('إلغاء')
                            .setStyle('Danger');


                        const acttionRow = new ActionRowBuilder().addComponents(cancelButton);

                        await interaction.update({
                            content: `<@${interaction.user.id}> - يرجى إرفاق ايدي الشخص الجديد لتحويل ملكية البوتات إليه`,
                            components: [acttionRow]
                        });

                        const messageFilter = (msg) => msg.author.id === interaction.user.id;
                        const response = await message.channel.awaitMessages({ filter: messageFilter, max: 1, time: 60000 });

                        if (response.size === 0) {
                            return interaction.editReply({
                                content: '**أنـتـهى وقـت الأرسـال ⏳.**',
                                components: []
                            });
                        }

                        const newUser = response.first().content;

                        let newUserId;
                        if (newUser.startsWith('<@') && newUser.endsWith('>')) {
                            newUserId = newUser.slice(2, -1);
                        } else if (/^\d+$/.test(newUser)) {
                            newUserId = newUser;
                        } else {
                            await response.first().delete();
                            return interaction.editReply({ content: 'إستخدام خطأ، يرجى إرفاق منشن شخص صحيح.', components: [] });
                        }

                        let transferredBotsCount = 0;
                        try {
                            const data = fs.readFileSync('./settings/time.json', 'utf8');
                            let subscriptions = JSON.parse(data);

                            subscriptions.forEach(sub => {
                                if (selectedCodes.includes(sub.code)) {
                                    sub.user = newUserId;
                                    transferredBotsCount += sub.botsCount;
                                }
                            });

                            fs.writeFileSync('./settings/time.json', JSON.stringify(subscriptions, null, 2));

                            await interaction.editReply({
                                content: `تم نقل ملكية جميع البوتات بنجاح، البوتات المتأثرة: **${transferredBotsCount}**`,
                                components: []
                            });

                            await response.first().delete();

                            try {
                                const tokensData = fs.readFileSync('./settings/tokens.json', 'utf8');
                                let tokens = JSON.parse(tokensData);

                                tokens.forEach(token => {
                                    if (selectedCodes.includes(token.code)) {
                                        token.client = newUserId;
                                    }
                                });

                                fs.writeFileSync('./settings/tokens.json', JSON.stringify(tokens, null, 2));
                            } catch (error) {
                                return;
                            }

                        } catch (error) {
                            return interaction.update({ content: `\`\`\`.حدث خطأ، يرجى التواصل مع الدعم الفني\`\`\``, components: [] });
                        }



                    } else if (selectedOption === 'restart') {


                        const lastClaimTime = await db.get(`restart-${message.author.id}`) || 0;
                        const currentTime = Date.now();
                        const timeDifference = currentTime - lastClaimTime;

                        if (timeDifference < 300000) {
                            const remainingTime = 300000 - timeDifference;
                            const minutes = Math.floor(remainingTime / (1000 * 60));
                            const seconds = Math.ceil((remainingTime % (1000 * 60)) / 1000);

                            const formattedTime = `${minutes < 10 ? '0' : ''}${minutes}:${seconds < 10 ? '0' : ''}${seconds}`;

                            if (!interaction.replied && !interaction.deferred) {
                                interaction.message.delete();
                                return message.channel.send({ content: `⌛ يجب أن تنتظر ${formattedTime} قبل إستخدام هذا الأمر مرة أخرى` });
                            }
                            return;
                        }


                        const userId = message.author.id;
                        let tokens = JSON.parse(fs.readFileSync('./settings/tokens.json', 'utf8'));

                        const userTokens = tokens.filter(token => token.client === userId);
                        const remainingTokens = tokens.filter(token => token.client !== userId);

                        if (userTokens.length === 0) {
                            return;
                        }

                        await interaction.deferUpdate();
                        db.set(`restart-${message.author.id}`, currentTime);

                        const date = new Date();
                        const formattedDate = `${date.getFullYear()}-${(date.getMonth() + 1).toString().padStart(2, '0')}-${date.getDate().toString().padStart(2, '0')}_${date.getHours().toString().padStart(2, '0')}-${date.getMinutes().toString().padStart(2, '0')}-${date.getSeconds().toString().padStart(2, '0')}`;
                        const backupFile = `./settings/backup/tokensbackup-${formattedDate}.json`;

                        fs.copyFileSync('./settings/tokens.json', backupFile);


                        const reply = await interaction.followUp({
                            content: ` جاري إعادة تشغيل **${userTokens.length}** بوتات، الوقت المُقدر لتشغيلها (\`0:20\`) ثانيا تقريبًا`,
                            ephemeral: false
                        });

                        const disabledComponents = interaction.message.components.map(row => {
                            return new ActionRowBuilder().addComponents(
                                row.components.map(component => {
                                    if (component.type === ComponentType.Button) {
                                        return ButtonBuilder.from(component).setDisabled(true);
                                    } else if (component.type === ComponentType.StringSelect) {
                                        return StringSelectMenuBuilder.from(component).setDisabled(true);
                                    } else {
                                        return component;
                                    }
                                })
                            );
                        });

                        await interaction.message.edit({ components: disabledComponents });

                        fs.writeFileSync('./settings/tokens.json', JSON.stringify(remainingTokens, null, 2), 'utf8');

                        setTimeout(async () => {
                            let updatedTokens = JSON.parse(fs.readFileSync('./settings/tokens.json', 'utf8'));
                            updatedTokens.push(...userTokens);
                            fs.writeFileSync('./settings/tokens.json', JSON.stringify(updatedTokens, null, 2), 'utf8');


                            await reply.edit({
                                content: `إستخدام ناجح، تم إعادة تشغيل البوتات بنجاح، البوتات المتأثرة: **${userTokens.length}**`
                            });

                        }, 20000);
                    } if (selectedOption === 'platform') {
                        const selectMenu = new StringSelectMenuBuilder()
                            .setCustomId('vipOptions')
                            .setPlaceholder('يرجى الاختيار ..')
                            .addOptions([
                                {
                                    label: 'يوتيوب',
                                    emoji: '1344143396893233152',
                                    description: 'من أجل تحديد منصة البحث والتشغيل الأساسية، يوتيوب',
                                    value: 'YouTube',
                                }, {
                                    label: 'ساندكلاود',
                                    emoji: '1344143819276292247',
                                    description: 'من أجل تحديد منصة البحث والتشغيل الأساسية، ساندكلاود',
                                    value: 'SoundCloud',
                                }
                            ]);

                        const cancelButton = new ButtonBuilder()
                            .setCustomId('cancel')
                            .setLabel('إلغاء')
                            .setStyle('Danger');

                        const replyMessage = await interaction.update({
                            content: `**أخـتـر الأمـر.**`,
                            components: [
                                new ActionRowBuilder().addComponents(selectMenu),
                                new ActionRowBuilder().addComponents(cancelButton)
                            ]
                        });

						const filter = (i) => i.user.id === message.author.id;
						const collector = replyMessage.createMessageComponentCollector({ filter, time: 60000 });

						collector.on('collect', async (interaction) => {
							// زر الإلغاء
							if (interaction.isButton() && interaction.customId === 'cancel') {
								await interaction.deferUpdate().catch(() => {});
								await interaction.message.delete().catch(() => {});
								collector.stop('cancel');
								return;
							}

							if (!interaction.isStringSelectMenu() || interaction.customId !== 'vipOptions') return;
							const selectedOption = interaction.values[0];
                            if (selectedOption === 'YouTube') {
                                const lastClaimTime = await db.get(`YouTubeeditbuttons_${message.author.id}`) || 0;
                                const currentTime = Date.now();
                                const timeDifference = currentTime - lastClaimTime;

                                if (timeDifference < 240000) {
                                    const remainingTime = 240000 - timeDifference;
                                    const minutes = Math.floor(remainingTime / (1000 * 60));
                                    const seconds = Math.ceil((remainingTime % (1000 * 60)) / 1000);

                                    const formattedTime = `${minutes < 10 ? '0' : ''}${minutes}:${seconds < 10 ? '0' : ''}${seconds}`;

                                    if (!interaction.replied && !interaction.deferred) {
                                        interaction.message.delete();
                                        return message.reply({ content: `⌛ يجب أن تنتظر ${formattedTime} قبل إستخدام هذا الأمر مرة أخرى` });
                                    }
                                    return;
                                }

                                await interaction.deferUpdate();

                                const currentTokenData = tokens.filter(token => token.client === userId);
                                currentTokenData.forEach(tokenData => {
                                    tokenData.source = "ytsearch";
                                });

                                const disabledComponents = interaction.message.components.map(row => {
                                    return new ActionRowBuilder().addComponents(
                                        row.components.map(component => {
                                            if (component.type === ComponentType.Button) {
                                                return ButtonBuilder.from(component).setDisabled(true);
                                            } else if (component.type === ComponentType.StringSelect) {
                                                return StringSelectMenuBuilder.from(component).setDisabled(true);
                                            } else {
                                                return component;
                                            }
                                        })
                                    );
                                });

                                try {
                                    fs.writeFileSync('./settings/tokens.json', JSON.stringify(tokens, null, 2), 'utf8');
                                    const botCount = currentTokenData.length;
                                    db.set(`YouTubeeditbuttons_${message.author.id}`, currentTime);
                                    await interaction.followUp({ content: `تم تعيين منصة التشغيل الأساسية لجميع البوتات إلى يوتيوب، البوتات المتأثرة : **${botCount}**` });
                                    interaction.editReply({ components: disabledComponents });
                                } catch (error) {
                                    console.error('حدث خطأ أثناء تحديث ملف التوكنات:', error);
                                    interaction.followUp({ content: `\`\`\`.حدث خطأ، يرجى التواصل مع الدعم الفني\`\`\``, components: [] });
                                    interaction.editReply({ components: disabledComponents });
                                }

                            } else if (selectedOption === 'SoundCloud') {

                                const lastClaimTime = await db.get(`YouTubeeditbuttons_${message.author.id}`) || 0;
                                const currentTime = Date.now();
                                const timeDifference = currentTime - lastClaimTime;

                                if (timeDifference < 240000) {
                                    const remainingTime = 240000 - timeDifference;
                                    const minutes = Math.floor(remainingTime / (1000 * 60));
                                    const seconds = Math.ceil((remainingTime % (1000 * 60)) / 1000);

                                    const formattedTime = `${minutes < 10 ? '0' : ''}${minutes}:${seconds < 10 ? '0' : ''}${seconds}`;

                                    if (!interaction.replied && !interaction.deferred) {
                                        interaction.message.delete();
                                        return message.reply({ content: `⌛ يجب أن تنتظر ${formattedTime} قبل إستخدام هذا الأمر مرة أخرى` });
                                    }
                                    return;
                                }

                                await interaction.deferUpdate();

                                const currentTokenData = tokens.filter(token => token.client === userId);
                                currentTokenData.forEach(tokenData => {
                                    tokenData.source = "scsearch";
                                });

                                const disabledComponents = interaction.message.components.map(row => {
                                    return new ActionRowBuilder().addComponents(
                                        row.components.map(component => {
                                            if (component.type === ComponentType.Button) {
                                                return ButtonBuilder.from(component).setDisabled(true);
                                            } else if (component.type === ComponentType.StringSelect) {
                                                return StringSelectMenuBuilder.from(component).setDisabled(true);
                                            } else {
                                                return component;
                                            }
                                        })
                                    );
                                });

                                try {
                                    fs.writeFileSync('./settings/tokens.json', JSON.stringify(tokens, null, 2), 'utf8');
                                    const botCount = currentTokenData.length;
                                    db.set(`soundcloudeditbuttons_${message.author.id}`, currentTime);
                                    await interaction.followUp({ content: `تم تعيين منصة التشغيل الأساسية لجميع البوتات إلى ساندكلاود، البوتات المتأثرة : **${botCount}**` });
                                    interaction.editReply({ components: disabledComponents });
                                } catch (error) {
                                    console.error('حدث خطأ أثناء تحديث ملف التوكنات:', error);
                                    interaction.followUp({ content: `\`\`\`.حدث خطأ، يرجى التواصل مع الدعم الفني\`\`\``, components: [] });
                                    interaction.editReply({ components: disabledComponents });
                                }
                            }

                        });
                    }
                });
            }
        });
    }
};
