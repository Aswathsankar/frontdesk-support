import React, { useState } from 'react';
import {
  Box, Paper, Typography, TextField, Button, Alert, Chip,
  Stepper, Step, StepLabel, Divider, AppBar, Toolbar, CircularProgress,
} from '@mui/material';
import { useFormik } from 'formik';
import * as Yup from 'yup';
import { publicApi } from '../api/agentApi.js';

const createSchema = Yup.object({
  customer_email: Yup.string().email('Invalid email').required('Required'),
  subject: Yup.string().min(5, 'Too short').required('Required'),
  priority: Yup.string().oneOf(['urgent', 'medium', 'low']).required(),
});

const replySchema = Yup.object({
  customer_email: Yup.string().email('Invalid email').required('Required'),
  body: Yup.string().min(1, 'Required').required('Required'),
});

const lookupSchema = Yup.object({
  ref: Yup.string().uuid('Must be a valid UUID').required('Required'),
});

const PRIORITY_COLORS = { urgent: 'error', medium: 'warning', low: 'default' };
const STATUS_COLORS = { new: 'info', open: 'primary', waiting_on_customer: 'warning', resolved: 'success', closed: 'default' };

export default function CustomerSimulator() {
  const [ticket, setTicket] = useState(null);
  const [ticketRef, setTicketRef] = useState('');
  const [messages, setMessages] = useState([]);
  const [canReopen, setCanReopen] = useState(false);
  const [createSuccess, setCreateSuccess] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  // ── Create ticket
  const createFormik = useFormik({
    initialValues: { customer_email: '', subject: '', priority: 'medium' },
    validationSchema: createSchema,
    onSubmit: async (values, { setSubmitting, resetForm }) => {
      setError(''); setCreateSuccess('');
      try {
        const { data } = await publicApi.post('/tickets', values);
        setCreateSuccess(`Ticket created! Your reference: ${data.customer_ref}`);
        setTicketRef(data.customer_ref);
        resetForm();
      } catch (err) {
        setError(err.response?.data?.error || 'Failed to create ticket');
      } finally {
        setSubmitting(false);
      }
    },
  });

  // ── Lookup ticket by ref
  const lookupFormik = useFormik({
    initialValues: { ref: ticketRef },
    validationSchema: lookupSchema,
    enableReinitialize: true,
    onSubmit: async (values, { setSubmitting }) => {
      setError('');
      try {
        const { data } = await publicApi.get(`/tickets/${values.ref}`);
        setTicket(data.ticket);
        setMessages(data.messages);
        setCanReopen(data.can_reopen);
        setTicketRef(values.ref);
      } catch (err) {
        setError(err.response?.data?.error || 'Ticket not found');
        setTicket(null);
      } finally {
        setSubmitting(false);
      }
    },
  });

  // ── Reply
  const replyFormik = useFormik({
    initialValues: { customer_email: ticket?.customer_email || '', body: '' },
    validationSchema: replySchema,
    enableReinitialize: true,
    onSubmit: async (values, { setSubmitting, resetForm }) => {
      setError(''); setSuccess('');
      try {
        await publicApi.post(`/tickets/${ticketRef}/reply`, values);
        setSuccess('Reply sent!');
        // Refresh
        const { data } = await publicApi.get(`/tickets/${ticketRef}`);
        setTicket(data.ticket);
        setMessages(data.messages);
        resetForm({ values: { customer_email: values.customer_email, body: '' } });
      } catch (err) {
        setError(err.response?.data?.error || 'Failed to send reply');
      } finally {
        setSubmitting(false);
      }
    },
  });

  // ── Reopen
  const handleReopen = async () => {
    setError(''); setSuccess('');
    try {
      await publicApi.post(`/tickets/${ticketRef}/reopen`, { customer_email: ticket.customer_email });
      setSuccess('Ticket reopened!');
      const { data } = await publicApi.get(`/tickets/${ticketRef}`);
      setTicket(data.ticket);
      setCanReopen(data.can_reopen);
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to reopen ticket');
    }
  };

  return (
    <Box sx={{ minHeight: '100vh', background: '#0f172a' }}>
      <AppBar position="sticky" sx={{ background: '#1e293b', borderBottom: '1px solid rgba(16,185,129,0.2)' }}>
        <Toolbar>
          <Typography variant="h6" sx={{ flexGrow: 1, fontWeight: 700, color: '#10b981' }}>
            🎫 Frontdesk — Customer Portal
          </Typography>
          <Typography variant="caption" sx={{ color: '#475569' }}>For reviewer testing only</Typography>
        </Toolbar>
      </AppBar>

      <Box sx={{ p: 3, maxWidth: 900, mx: 'auto', display: 'grid', gridTemplateColumns: { xs: '1fr', md: '1fr 1fr' }, gap: 3 }}>
        {/* Create ticket */}
        <Paper sx={{ p: 3, background: '#1e293b', border: '1px solid rgba(16,185,129,0.2)' }}>
          <Typography variant="h6" sx={{ color: '#10b981', mb: 2, fontWeight: 700 }}>Submit a Ticket</Typography>

          {createSuccess && <Alert severity="success" sx={{ mb: 2 }}>{createSuccess}</Alert>}
          {error && !ticket && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}

          <form onSubmit={createFormik.handleSubmit} id="create-ticket-form">
            <TextField
              id="create-email"
              name="customer_email"
              label="Your email"
              fullWidth margin="dense"
              value={createFormik.values.customer_email}
              onChange={createFormik.handleChange}
              onBlur={createFormik.handleBlur}
              error={createFormik.touched.customer_email && Boolean(createFormik.errors.customer_email)}
              helperText={createFormik.touched.customer_email && createFormik.errors.customer_email}
            />
            <TextField
              id="create-subject"
              name="subject"
              label="Describe your issue"
              fullWidth margin="dense" multiline rows={3}
              value={createFormik.values.subject}
              onChange={createFormik.handleChange}
              onBlur={createFormik.handleBlur}
              error={createFormik.touched.subject && Boolean(createFormik.errors.subject)}
              helperText={createFormik.touched.subject && createFormik.errors.subject}
            />
            <TextField
              id="create-priority"
              name="priority"
              label="Priority"
              select fullWidth margin="dense"
              value={createFormik.values.priority}
              onChange={createFormik.handleChange}
              SelectProps={{ native: true }}
            >
              <option value="low">Low — question or small request</option>
              <option value="medium">Medium — impacting work</option>
              <option value="urgent">Urgent — cannot work at all</option>
            </TextField>
            <Button
              id="create-ticket-btn"
              type="submit" variant="contained" fullWidth sx={{ mt: 2, background: 'linear-gradient(135deg, #10b981, #059669)' }}
              disabled={createFormik.isSubmitting}
            >
              {createFormik.isSubmitting ? <CircularProgress size={22} color="inherit" /> : 'Submit Ticket'}
            </Button>
          </form>
        </Paper>

        {/* Look up / reply */}
        <Box>
          <Paper sx={{ p: 3, background: '#1e293b', border: '1px solid rgba(99,102,241,0.2)', mb: 2 }}>
            <Typography variant="h6" sx={{ color: '#6366f1', mb: 2, fontWeight: 700 }}>Look Up Ticket</Typography>
            <form onSubmit={lookupFormik.handleSubmit} id="lookup-form">
              <TextField
                id="lookup-ref"
                name="ref"
                label="Your ticket reference (UUID)"
                fullWidth margin="dense"
                value={lookupFormik.values.ref}
                onChange={lookupFormik.handleChange}
                onBlur={lookupFormik.handleBlur}
                error={lookupFormik.touched.ref && Boolean(lookupFormik.errors.ref)}
                helperText={lookupFormik.touched.ref && lookupFormik.errors.ref}
              />
              <Button
                id="lookup-btn"
                type="submit" variant="outlined" fullWidth sx={{ mt: 1, borderColor: '#6366f1', color: '#6366f1' }}
                disabled={lookupFormik.isSubmitting}
              >
                Load Ticket
              </Button>
            </form>
          </Paper>

          {ticket && (
            <Paper sx={{ p: 3, background: '#1e293b', border: '1px solid rgba(99,102,241,0.15)' }}>
              <Box sx={{ display: 'flex', gap: 1, mb: 1, flexWrap: 'wrap' }}>
                <Chip label={ticket.priority} color={PRIORITY_COLORS[ticket.priority]} size="small" />
                <Chip label={ticket.status.replace('_', ' ')} color={STATUS_COLORS[ticket.status]} size="small" variant="outlined" />
              </Box>
              <Typography variant="subtitle1" sx={{ color: '#f1f5f9', mb: 0.5, fontWeight: 600 }}>{ticket.subject}</Typography>
              <Typography variant="caption" sx={{ color: '#475569', display: 'block', mb: 2 }}>Ref: {ticket.customer_ref}</Typography>

              {error && <Alert severity="error" sx={{ mb: 1 }}>{error}</Alert>}
              {success && <Alert severity="success" sx={{ mb: 1 }}>{success}</Alert>}

              {/* Messages */}
              <Box sx={{ mb: 2, maxHeight: 250, overflowY: 'auto' }}>
                {messages.map((m) => (
                  <Box key={m.id} sx={{ mb: 1, p: 1.5, background: m.author_type === 'agent' ? '#0f172a' : 'rgba(99,102,241,0.1)', borderRadius: 1 }}>
                    <Typography variant="caption" sx={{ color: '#94a3b8' }}>{m.author_name ?? 'Customer'} · {new Date(m.created_at).toLocaleString()}</Typography>
                    <Typography variant="body2" sx={{ color: '#f1f5f9', mt: 0.5 }}>{m.body}</Typography>
                  </Box>
                ))}
              </Box>

              {/* Reply */}
              {!['resolved', 'closed'].includes(ticket.status) && (
                <form onSubmit={replyFormik.handleSubmit} id="customer-reply-form">
                  <TextField
                    id="reply-email"
                    name="customer_email"
                    label="Your email"
                    fullWidth margin="dense" size="small"
                    value={replyFormik.values.customer_email}
                    onChange={replyFormik.handleChange}
                  />
                  <TextField
                    id="reply-body"
                    name="body"
                    label="Your reply"
                    fullWidth margin="dense" multiline rows={2}
                    value={replyFormik.values.body}
                    onChange={replyFormik.handleChange}
                  />
                  <Button
                    id="send-customer-reply-btn"
                    type="submit" variant="contained" size="small" sx={{ mt: 1, background: 'linear-gradient(135deg, #6366f1, #8b5cf6)' }}
                    disabled={replyFormik.isSubmitting}
                  >
                    Send Reply
                  </Button>
                </form>
              )}

              {/* Reopen */}
              {ticket.status === 'resolved' && (
                <Box sx={{ mt: 2 }}>
                  <Button
                    id="reopen-btn"
                    variant="outlined" color="warning"
                    onClick={handleReopen}
                    disabled={!canReopen}
                    fullWidth
                  >
                    {canReopen ? 'Reopen Ticket' : 'Reopen Window Closed — Create New Ticket'}
                  </Button>
                </Box>
              )}
            </Paper>
          )}
        </Box>
      </Box>
    </Box>
  );
}
