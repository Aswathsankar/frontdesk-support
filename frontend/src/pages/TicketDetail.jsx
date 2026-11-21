import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  Box, Typography, Paper, Chip, Button, Divider, CircularProgress,
  TextField, AppBar, Toolbar, IconButton, Alert, Select, MenuItem,
  FormControl, InputLabel, Dialog, DialogTitle, DialogContent, DialogActions,
  Tooltip,
} from '@mui/material';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import PersonIcon from '@mui/icons-material/Person';
import LockIcon from '@mui/icons-material/Lock';
import SupportAgentIcon from '@mui/icons-material/SupportAgent';
import InfoIcon from '@mui/icons-material/Info';
import TimerIcon from '@mui/icons-material/Timer';
import { agentApi } from '../api/agentApi.js';
import { useAuth } from '../App.jsx';

const PRIORITY_COLORS = { urgent: 'error', medium: 'warning', low: 'default' };
const STATUS_COLORS = { new: 'info', open: 'primary', waiting_on_customer: 'warning', resolved: 'success', closed: 'default' };

function formatMinutes(min) {
  if (min === null || min === undefined) return '—';
  const abs = Math.abs(min);
  const sign = min < 0 ? '-' : '';
  if (abs < 60) return `${sign}${Math.round(abs)}m`;
  const h = Math.floor(abs / 60), m = Math.round(abs % 60);
  return `${sign}${h}h${m > 0 ? ` ${m}m` : ''}`;
}

function TimelineItem({ msg, type }) {
  if (type === 'status_change') {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', my: 1 }}>
        <Chip label={msg} size="small" sx={{ color: '#475569', borderColor: '#334155', fontSize: 11 }} variant="outlined" />
      </Box>
    );
  }

  const isInternal = msg.visibility === 'internal';
  const isCustomer = msg.author_type === 'customer';
  const isSystem   = msg.author_type === 'system';

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: isCustomer ? 'flex-start' : 'flex-end', mb: 2 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.5 }}>
        {isInternal && <LockIcon sx={{ fontSize: 14, color: '#f59e0b' }} />}
        <Typography variant="caption" sx={{ color: '#94a3b8' }}>
          {isInternal ? '🔒 Team only — ' : ''}{msg.author_name ?? (isSystem ? 'System' : 'Customer')} ·{' '}
          {new Date(msg.created_at).toLocaleString()}
        </Typography>
      </Box>
      <Paper sx={{
        p: 2, maxWidth: '75%',
        background: isInternal
          ? 'rgba(245,158,11,0.12)'
          : isCustomer
            ? 'rgba(99,102,241,0.12)'
            : '#1e293b',
        border: isInternal ? '1px solid rgba(245,158,11,0.3)' : '1px solid rgba(99,102,241,0.15)',
      }}>
        <Typography variant="body2" sx={{ color: '#f1f5f9', whiteSpace: 'pre-wrap' }}>{msg.body}</Typography>
      </Paper>
    </Box>
  );
}

export default function TicketDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { agent } = useAuth();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [replyBody, setReplyBody] = useState('');
  const [noteBody, setNoteBody] = useState('');
  const [sending, setSending] = useState(false);
  const [agents, setAgents] = useState([]);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [auditOpen, setAuditOpen] = useState(false);
  const [auditEvents, setAuditEvents] = useState([]);

  const fetchTicket = async () => {
    try {
      const { data: d } = await agentApi.get(`/agent/tickets/${id}`);
      setData(d);
    } catch { }
    setLoading(false);
  };

  useEffect(() => { fetchTicket(); }, [id]);

  useEffect(() => {
    agentApi.get('/agent/agents').then((r) => setAgents(r.data.agents)).catch(() => {});
  }, []);

  const action = async (fn) => {
    setError(''); setSuccess('');
    setSending(true);
    try {
      await fn();
      setSuccess('Done!');
      await fetchTicket();
    } catch (err) {
      setError(err.response?.data?.error || 'An error occurred');
    } finally {
      setSending(false);
    }
  };

  const sendReply = () => action(async () => {
    await agentApi.post(`/agent/tickets/${id}/reply`, { body: replyBody });
    setReplyBody('');
  });

  const sendNote = () => action(async () => {
    await agentApi.post(`/agent/tickets/${id}/notes`, { body: noteBody });
    setNoteBody('');
  });

  const claim = () => action(() => agentApi.post(`/agent/tickets/${id}/claim`));
  const resolve = () => action(() => agentApi.post(`/agent/tickets/${id}/resolve`));
  const wait = () => action(() => agentApi.post(`/agent/tickets/${id}/wait`));

  const changePriority = (p) => action(() => agentApi.post(`/agent/tickets/${id}/priority`, { priority: p }));

  const openAudit = async () => {
    const { data: a } = await agentApi.get(`/agent/tickets/${id}/audit`);
    setAuditEvents(a.events);
    setAuditOpen(true);
  };

  if (loading) return <Box sx={{ display: 'flex', justifyContent: 'center', pt: 10 }}><CircularProgress sx={{ color: '#6366f1' }} /></Box>;
  if (!data) return <Box sx={{ p: 4 }}><Alert severity="error">Ticket not found</Alert></Box>;

  const { ticket, messages } = data;

  return (
    <Box sx={{ minHeight: '100vh', background: '#0f172a' }}>
      <AppBar position="sticky" sx={{ background: '#1e293b', borderBottom: '1px solid rgba(99,102,241,0.2)' }}>
        <Toolbar>
          <IconButton onClick={() => navigate('/')} sx={{ color: '#94a3b8', mr: 1 }}>
            <ArrowBackIcon />
          </IconButton>
          <Typography variant="h6" sx={{ flexGrow: 1, fontWeight: 700, color: '#6366f1' }}>Frontdesk</Typography>
          <Button size="small" id="audit-btn" onClick={openAudit} sx={{ color: '#94a3b8' }}>Audit Log</Button>
        </Toolbar>
      </AppBar>

      <Box sx={{ p: 3, maxWidth: 1100, mx: 'auto', display: 'grid', gridTemplateColumns: { xs: '1fr', md: '1fr 320px' }, gap: 3 }}>
        {/* Left: timeline */}
        <Box>
          {/* Ticket header */}
          <Paper sx={{ p: 3, mb: 3, background: '#1e293b', border: '1px solid rgba(99,102,241,0.15)' }}>
            <Box sx={{ display: 'flex', gap: 1, mb: 2, flexWrap: 'wrap' }}>
              <Chip label={`#${ticket.id}`} size="small" sx={{ color: '#475569' }} />
              <Chip label={ticket.priority} color={PRIORITY_COLORS[ticket.priority]} size="small" id="detail-priority-chip" />
              <Chip label={ticket.status.replace('_', ' ')} color={STATUS_COLORS[ticket.status]} size="small" variant="outlined" />
              {ticket.is_late && <Chip label="LATE" color="error" size="small" id="detail-late-badge" />}
              {ticket.is_waiting && <Chip label="WAITING ON CUSTOMER" color="warning" size="small" />}
            </Box>
            <Typography variant="h6" sx={{ color: '#f1f5f9', mb: 1 }}>{ticket.subject}</Typography>
            <Typography variant="body2" sx={{ color: '#94a3b8' }}>From: {ticket.customer_email}</Typography>
            <Typography variant="caption" sx={{ color: '#475569' }}>Ref: {ticket.customer_ref}</Typography>

            {/* SLA countdown */}
            <Box sx={{ display: 'flex', gap: 3, mt: 2 }}>
              <Box>
                <Typography variant="caption" sx={{ color: '#94a3b8' }}>Response SLA</Typography>
                <Typography variant="body2" sx={{ color: ticket.response_late ? '#ef4444' : '#10b981', fontWeight: 600 }}>
                  {ticket.first_response_at ? '✓ Sent' : formatMinutes(ticket.responseRemaining)}
                </Typography>
              </Box>
              <Box>
                <Typography variant="caption" sx={{ color: '#94a3b8' }}>Resolution SLA</Typography>
                <Typography variant="body2" sx={{ color: ticket.resolution_late ? '#ef4444' : '#10b981', fontWeight: 600 }}>
                  {formatMinutes(ticket.resolutionRemaining)}
                </Typography>
              </Box>
            </Box>
          </Paper>

          {/* Messages timeline */}
          <Box sx={{ mb: 3 }}>
            {messages.map((msg) => (
              <TimelineItem key={msg.id} msg={msg} type="message" />
            ))}
          </Box>

          {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
          {success && <Alert severity="success" sx={{ mb: 2 }}>{success}</Alert>}

          {/* Reply */}
          {!['resolved', 'closed'].includes(ticket.status) && (
            <>
              <Paper sx={{ p: 2, mb: 2, background: '#1e293b', border: '1px solid rgba(99,102,241,0.15)' }}>
                <Typography variant="subtitle2" sx={{ color: '#94a3b8', mb: 1 }}>Reply to customer</Typography>
                <TextField
                  id="reply-body"
                  multiline rows={3} fullWidth
                  placeholder="Type your reply to the customer..."
                  value={replyBody}
                  onChange={(e) => setReplyBody(e.target.value)}
                  sx={{ mb: 1 }}
                />
                <Button
                  id="send-reply-btn"
                  variant="contained" disabled={!replyBody.trim() || sending}
                  onClick={sendReply}
                  sx={{ background: 'linear-gradient(135deg, #6366f1, #8b5cf6)' }}
                >
                  Send Reply
                </Button>
              </Paper>

              <Paper sx={{ p: 2, background: 'rgba(245,158,11,0.08)', border: '1px solid rgba(245,158,11,0.2)' }}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
                  <LockIcon sx={{ fontSize: 16, color: '#f59e0b' }} />
                  <Typography variant="subtitle2" sx={{ color: '#f59e0b' }}>Internal note (Team only)</Typography>
                </Box>
                <TextField
                  id="note-body"
                  multiline rows={2} fullWidth
                  placeholder="Add an internal note (never shown to customer)..."
                  value={noteBody}
                  onChange={(e) => setNoteBody(e.target.value)}
                  sx={{ mb: 1 }}
                />
                <Button
                  id="send-note-btn"
                  variant="outlined" disabled={!noteBody.trim() || sending}
                  onClick={sendNote}
                  sx={{ borderColor: '#f59e0b', color: '#f59e0b', '&:hover': { borderColor: '#f59e0b', background: 'rgba(245,158,11,0.1)' } }}
                >
                  Add Note
                </Button>
              </Paper>
            </>
          )}
        </Box>

        {/* Right: actions sidebar */}
        <Box>
          <Paper sx={{ p: 2, background: '#1e293b', border: '1px solid rgba(99,102,241,0.15)', mb: 2 }}>
            <Typography variant="subtitle2" sx={{ color: '#94a3b8', mb: 2 }}>Actions</Typography>

            {!ticket.assignee_id && (
              <Button id="claim-btn" fullWidth variant="contained" onClick={claim} disabled={sending} sx={{ mb: 1, background: 'linear-gradient(135deg, #6366f1, #8b5cf6)' }}>
                Take Ticket
              </Button>
            )}

            {ticket.assignee_id === agent?.id && ticket.status === 'open' && (
              <Button id="wait-btn" fullWidth variant="outlined" onClick={wait} disabled={sending} sx={{ mb: 1, borderColor: '#f59e0b', color: '#f59e0b' }}>
                Set Waiting on Customer
              </Button>
            )}

            {!['resolved', 'closed'].includes(ticket.status) && (
              <Button id="resolve-btn" fullWidth variant="outlined" color="success" onClick={resolve} disabled={sending} sx={{ mb: 1 }}>
                Mark Resolved
              </Button>
            )}
          </Paper>

          {/* Priority change */}
          <Paper sx={{ p: 2, background: '#1e293b', border: '1px solid rgba(99,102,241,0.15)', mb: 2 }}>
            <Typography variant="subtitle2" sx={{ color: '#94a3b8', mb: 1 }}>Change Priority</Typography>
            {['urgent', 'medium', 'low'].filter((p) => p !== ticket.priority).map((p) => (
              <Button
                key={p}
                id={`priority-${p}-btn`}
                fullWidth variant="outlined" size="small"
                onClick={() => changePriority(p)}
                disabled={sending}
                color={PRIORITY_COLORS[p]}
                sx={{ mb: 0.5 }}
              >
                Set {p}
              </Button>
            ))}
          </Paper>

          {/* Ticket meta */}
          <Paper sx={{ p: 2, background: '#1e293b', border: '1px solid rgba(99,102,241,0.15)' }}>
            <Typography variant="subtitle2" sx={{ color: '#94a3b8', mb: 2 }}>Details</Typography>
            <Typography variant="caption" display="block" sx={{ color: '#475569', mb: 0.5 }}>Assignee</Typography>
            <Typography variant="body2" sx={{ color: '#f1f5f9', mb: 2 }}>{ticket.assignee_name ?? '— Unassigned'}</Typography>
            <Typography variant="caption" display="block" sx={{ color: '#475569', mb: 0.5 }}>Created</Typography>
            <Typography variant="body2" sx={{ color: '#f1f5f9', mb: 2 }}>{new Date(ticket.created_at).toLocaleString()}</Typography>
            {ticket.resolved_at && <>
              <Typography variant="caption" display="block" sx={{ color: '#475569', mb: 0.5 }}>Resolved</Typography>
              <Typography variant="body2" sx={{ color: '#f1f5f9', mb: 2 }}>{new Date(ticket.resolved_at).toLocaleString()}</Typography>
            </>}
          </Paper>
        </Box>
      </Box>

      {/* Audit dialog */}
      <Dialog open={auditOpen} onClose={() => setAuditOpen(false)} maxWidth="md" fullWidth id="audit-dialog">
        <DialogTitle sx={{ background: '#1e293b', color: '#f1f5f9' }}>Audit Log — Ticket #{ticket.id}</DialogTitle>
        <DialogContent sx={{ background: '#0f172a', p: 2 }}>
          {auditEvents.map((e, i) => (
            <Box key={e.id} sx={{ mb: 1, p: 1.5, background: '#1e293b', borderRadius: 1, border: '1px solid rgba(99,102,241,0.1)' }}>
              <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 0.5 }}>
                <Chip label={e.event_type} size="small" sx={{ fontSize: 10 }} />
                <Typography variant="caption" sx={{ color: '#475569' }}>{new Date(e.created_at).toLocaleString()}</Typography>
              </Box>
              <Typography variant="caption" sx={{ color: '#94a3b8' }}>
                {e.actor_type} {e.actor_id ? `#${e.actor_id}` : ''} · hash: {e.hash?.substring(0, 16)}…
              </Typography>
            </Box>
          ))}
        </DialogContent>
        <DialogActions sx={{ background: '#1e293b' }}>
          <Button onClick={() => setAuditOpen(false)} sx={{ color: '#94a3b8' }}>Close</Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
