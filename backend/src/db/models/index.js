import { DataTypes } from 'sequelize';

export function defineModels(sequelize) {
  const Agent = sequelize.define('Agent', {
    id:            { type: DataTypes.INTEGER.UNSIGNED, primaryKey: true, autoIncrement: true },
    name:          { type: DataTypes.STRING(100), allowNull: false },
    email:         { type: DataTypes.STRING(255), allowNull: false, unique: true },
    password_hash: { type: DataTypes.STRING(255), allowNull: false },
    created_at:    { type: DataTypes.DATE(3), defaultValue: DataTypes.NOW },
  }, { tableName: 'agents', timestamps: false });

  const Holiday = sequelize.define('Holiday', {
    id:   { type: DataTypes.INTEGER.UNSIGNED, primaryKey: true, autoIncrement: true },
    date: { type: DataTypes.DATEONLY, allowNull: false, unique: true },
    name: { type: DataTypes.STRING(100), allowNull: false },
  }, { tableName: 'holidays', timestamps: false });

  const Ticket = sequelize.define('Ticket', {
    id:                { type: DataTypes.INTEGER.UNSIGNED, primaryKey: true, autoIncrement: true },
    customer_ref:      { type: DataTypes.CHAR(36), allowNull: false, unique: true },
    customer_email:    { type: DataTypes.STRING(255), allowNull: false },
    subject:           { type: DataTypes.STRING(500), allowNull: false },
    priority:          { type: DataTypes.ENUM('urgent','medium','low'), allowNull: false, defaultValue: 'medium' },
    status:            { type: DataTypes.ENUM('new','open','waiting_on_customer','resolved','closed'), allowNull: false, defaultValue: 'new' },
    assignee_id:       { type: DataTypes.INTEGER.UNSIGNED, allowNull: true },
    version:           { type: DataTypes.INTEGER.UNSIGNED, allowNull: false, defaultValue: 0 },
    created_at:        { type: DataTypes.DATE(3), defaultValue: DataTypes.NOW },
    first_response_at: { type: DataTypes.DATE(3), allowNull: true },
    resolved_at:       { type: DataTypes.DATE(3), allowNull: true },
    closed_at:         { type: DataTypes.DATE(3), allowNull: true },
    response_due_at:   { type: DataTypes.DATE(3), allowNull: true },
    resolution_due_at: { type: DataTypes.DATE(3), allowNull: true },
    close_reason:      { type: DataTypes.ENUM('resolved','auto_closed_no_reply'), allowNull: true },
    related_ticket_id: { type: DataTypes.INTEGER.UNSIGNED, allowNull: true },
  }, { tableName: 'tickets', timestamps: false });

  const Message = sequelize.define('Message', {
    id:          { type: DataTypes.INTEGER.UNSIGNED, primaryKey: true, autoIncrement: true },
    ticket_id:   { type: DataTypes.INTEGER.UNSIGNED, allowNull: false },
    author_type: { type: DataTypes.ENUM('agent','customer','system'), allowNull: false },
    author_id:   { type: DataTypes.INTEGER.UNSIGNED, allowNull: true },
    author_name: { type: DataTypes.STRING(100), allowNull: true },
    body:        { type: DataTypes.TEXT, allowNull: false },
    visibility:  { type: DataTypes.ENUM('public','internal'), allowNull: false, defaultValue: 'public' },
    created_at:  { type: DataTypes.DATE(3), defaultValue: DataTypes.NOW },
  }, { tableName: 'messages', timestamps: false });

  const SlaPause = sequelize.define('SlaPause', {
    id:         { type: DataTypes.INTEGER.UNSIGNED, primaryKey: true, autoIncrement: true },
    ticket_id:  { type: DataTypes.INTEGER.UNSIGNED, allowNull: false },
    paused_at:  { type: DataTypes.DATE(3), allowNull: false },
    resumed_at: { type: DataTypes.DATE(3), allowNull: true },
  }, { tableName: 'sla_pauses', timestamps: false });

  const AuditEvent = sequelize.define('AuditEvent', {
    id:         { type: DataTypes.INTEGER.UNSIGNED, primaryKey: true, autoIncrement: true },
    ticket_id:  { type: DataTypes.INTEGER.UNSIGNED, allowNull: false },
    event_type: { type: DataTypes.STRING(50), allowNull: false },
    actor_type: { type: DataTypes.ENUM('agent','customer','system'), allowNull: false },
    actor_id:   { type: DataTypes.INTEGER.UNSIGNED, allowNull: true },
    payload:    { type: DataTypes.JSON, allowNull: false },
    created_at: { type: DataTypes.DATE(3), defaultValue: DataTypes.NOW },
    prev_hash:  { type: DataTypes.CHAR(64), allowNull: true },
    hash:       { type: DataTypes.CHAR(64), allowNull: false },
  }, { tableName: 'audit_events', timestamps: false });

  const SlaConfig = sequelize.define('SlaConfig', {
    priority:        { type: DataTypes.ENUM('urgent','medium','low'), primaryKey: true },
    first_reply_min: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false },
    resolution_min:  { type: DataTypes.INTEGER.UNSIGNED, allowNull: true },
  }, { tableName: 'sla_config', timestamps: false });

  // Associations
  Ticket.belongsTo(Agent, { foreignKey: 'assignee_id', as: 'assignee' });
  Agent.hasMany(Ticket, { foreignKey: 'assignee_id', as: 'tickets' });
  Message.belongsTo(Ticket, { foreignKey: 'ticket_id' });
  Ticket.hasMany(Message, { foreignKey: 'ticket_id', as: 'messages' });
  SlaPause.belongsTo(Ticket, { foreignKey: 'ticket_id' });
  Ticket.hasMany(SlaPause, { foreignKey: 'ticket_id', as: 'sla_pauses' });
  AuditEvent.belongsTo(Ticket, { foreignKey: 'ticket_id' });
  Ticket.hasMany(AuditEvent, { foreignKey: 'ticket_id', as: 'audit_events' });

  return { Agent, Holiday, Ticket, Message, SlaPause, AuditEvent, SlaConfig };
}
