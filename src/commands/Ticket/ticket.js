import {
    ChannelType,
    PermissionFlagsBits,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    EmbedBuilder
} from 'discord.js';

const ticketStore = new Map();

export function getTicket(channelId) {
    return ticketStore.get(channelId) || null;
}

export function getUserTickets(guildId, userId) {
    return [...ticketStore.values()].filter(
        ticket =>
            ticket.guildId === guildId &&
            ticket.userId === userId &&
            !ticket.closed
    );
}

export async function createTicket(
    guild,
    user,
    {
        categoryId = null,
        staffRoleId = null,
        type = 'support',
        maxTickets = 3
    } = {}
) {
    const existingTickets = getUserTickets(guild.id, user.id);

    if (existingTickets.length >= maxTickets) {
        throw new Error('MAX_TICKETS');
    }

    const category =
        categoryId
            ? guild.channels.cache.get(categoryId)
            : null;

    const staffRole =
        staffRoleId
            ? guild.roles.cache.get(staffRoleId)
            : null;

    const username = user.username
        .toLowerCase()
        .replace(/[^a-z0-9]/g, '')
        .slice(0, 20) || 'user';

    const channel = await guild.channels.create({
        name: `ticket-${username}`,
        type: ChannelType.GuildText,

        parent:
            category?.type === ChannelType.GuildCategory
                ? category.id
                : undefined,

        permissionOverwrites: [
            {
                id: guild.roles.everyone.id,

                deny: [
                    PermissionFlagsBits.ViewChannel
                ]
            },

            {
                id: user.id,

                allow: [
                    PermissionFlagsBits.ViewChannel,
                    PermissionFlagsBits.SendMessages,
                    PermissionFlagsBits.ReadMessageHistory,
                    PermissionFlagsBits.AttachFiles
                ]
            },

            ...(staffRole
                ? [
                    {
                        id: staffRole.id,

                        allow: [
                            PermissionFlagsBits.ViewChannel,
                            PermissionFlagsBits.SendMessages,
                            PermissionFlagsBits.ReadMessageHistory,
                            PermissionFlagsBits.ManageMessages,
                            PermissionFlagsBits.ManageChannels
                        ]
                    }
                ]
                : [])
        ]
    });

    const ticketData = {
        guildId: guild.id,
        channelId: channel.id,
        userId: user.id,

        type,

        claimedBy: null,

        priority: 'none',

        closed: false,

        createdAt: Date.now(),

        closedAt: null,

        closedBy: null
    };

    ticketStore.set(channel.id, ticketData);

    const embed = new EmbedBuilder()
        .setTitle('🎫 Ticket Opened')
        .setDescription(
            `Welcome ${user}!\n\n` +
            `Thank you for contacting support.\n` +
            `Please explain your issue below and a member of staff will assist you.`
        )
        .addFields(
            {
                name: 'Ticket Type',
                value: type,
                inline: true
            },
            {
                name: 'Priority',
                value: '⚪ None',
                inline: true
            },
            {
                name: 'Claimed By',
                value: 'Nobody',
                inline: true
            }
        )
        .setColor(0x3498db)
        .setTimestamp();

    const buttons = new ActionRowBuilder().addComponents(

        new ButtonBuilder()
            .setCustomId('ticket_claim')
            .setLabel('Claim')
            .setEmoji('👤')
            .setStyle(ButtonStyle.Primary),

        new ButtonBuilder()
            .setCustomId('ticket_priority')
            .setLabel('Priority')
            .setEmoji('🚨')
            .setStyle(ButtonStyle.Secondary),

        new ButtonBuilder()
            .setCustomId('ticket_close')
            .setLabel('Close')
            .setEmoji('🔒')
            .setStyle(ButtonStyle.Danger)
    );

    await channel.send({
        content: `${user}`,
        embeds: [embed],
        components: [buttons]
    });

    return channel;
}

export async function claimTicket(channel, user) {

    const ticket = getTicket(channel.id);

    if (!ticket) {
        throw new Error('NOT_TICKET');
    }

    if (ticket.claimedBy) {
        throw new Error('ALREADY_CLAIMED');
    }

    ticket.claimedBy = user.id;

    await channel.send({
        embeds: [
            new EmbedBuilder()
                .setTitle('👤 Ticket Claimed')
                .setDescription(
                    `${user} has claimed this ticket and will assist you.`
                )
                .setColor(0x2ecc71)
                .setTimestamp()
        ]
    });

    return ticket;
}

export async function unclaimTicket(channel, user) {

    const ticket = getTicket(channel.id);

    if (!ticket) {
        throw new Error('NOT_TICKET');
    }

    ticket.claimedBy = null;

    await channel.send({
        embeds: [
            new EmbedBuilder()
                .setTitle('👤 Ticket Unclaimed')
                .setDescription(
                    `${user} has unclaimed this ticket.`
                )
                .setColor(0xf1c40f)
                .setTimestamp()
        ]
    });

    return ticket;
}

export async function updateTicketPriority(
    channel,
    priority,
    user
) {

    const ticket = getTicket(channel.id);

    if (!ticket) {
        throw new Error('NOT_TICKET');
    }

    ticket.priority = priority;

    const priorityDisplay = {
        urgent: '🔴 URGENT',
        high: '🟠 HIGH',
        medium: '🟡 MEDIUM',
        low: '🟢 LOW',
        none: '⚪ NONE'
    };

    await channel.send({
        embeds: [
            new EmbedBuilder()
                .setTitle('🚨 Ticket Priority Updated')
                .setDescription(
                    `${user} changed the priority to **${priorityDisplay[priority] || priority}**.`
                )
                .setColor(
                    priority === 'urgent'
                        ? 0xe74c3c
                        : 0xf1c40f
                )
                .setTimestamp()
        ]
    });

    return ticket;
}

export async function closeTicket(
    channel,
    user,
    reason = 'No reason provided.',
    closedCategoryId = null
) {

    const ticket = getTicket(channel.id);

    if (!ticket) {
        throw new Error('NOT_TICKET');
    }

    if (ticket.closed) {
        throw new Error('ALREADY_CLOSED');
    }

    ticket.closed = true;
    ticket.closedBy = user.id;
    ticket.closedAt = Date.now();
    ticket.closeReason = reason;

    await channel.permissionOverwrites.edit(
        ticket.userId,
        {
            ViewChannel: true,
            SendMessages: false,
            ReadMessageHistory: true
        }
    );

    if (closedCategoryId) {

        const closedCategory =
            channel.guild.channels.cache.get(
                closedCategoryId
            );

        if (
            closedCategory &&
            closedCategory.type === ChannelType.GuildCategory
        ) {
            await channel.setParent(
                closedCategory.id,
                {
                    lockPermissions: false
                }
            ).catch(() => {});
        }
    }

    const buttons =
        new ActionRowBuilder().addComponents(

            new ButtonBuilder()
                .setCustomId('ticket_reopen')
                .setLabel('Reopen')
                .setEmoji('🔓')
                .setStyle(ButtonStyle.Success),

            new ButtonBuilder()
                .setCustomId('ticket_transcript')
                .setLabel('Transcript')
                .setEmoji('📄')
                .setStyle(ButtonStyle.Secondary),

            new ButtonBuilder()
                .setCustomId('ticket_delete')
                .setLabel('Delete')
                .setEmoji('🗑️')
                .setStyle(ButtonStyle.Danger)
        );

    await channel.send({
        embeds: [
            new EmbedBuilder()
                .setTitle('🔒 Ticket Closed')
                .setDescription(
                    `This ticket has been closed by ${user}.\n\n` +
                    `**Reason:** ${reason}`
                )
                .setColor(0xe74c3c)
                .setTimestamp()
        ],

        components: [buttons]
    });

    return ticket;
}

export async function reopenTicket(
    channel,
    user
) {

    const ticket = getTicket(channel.id);

    if (!ticket) {
        throw new Error('NOT_TICKET');
    }

    ticket.closed = false;

    await channel.permissionOverwrites.edit(
        ticket.userId,
        {
            ViewChannel: true,
            SendMessages: true,
            ReadMessageHistory: true,
            AttachFiles: true
        }
    );

    await channel.send({
        embeds: [
            new EmbedBuilder()
                .setTitle('🔓 Ticket Reopened')
                .setDescription(
                    `${user} reopened this ticket.`
                )
                .setColor(0x2ecc71)
                .setTimestamp()
        ]
    });

    return ticket;
}

export function deleteTicket(channelId) {
    ticketStore.delete(channelId);
}
