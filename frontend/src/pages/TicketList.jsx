import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Box, Typography, Paper, Chip, Button, ButtonGroup, CircularProgress,
  Table, TableBody, TableCell, TableContainer, TableHead, TableRow,
  Tooltip, AppBar, Toolbar, Avatar, IconButton, Menu, MenuItem,
  TextField, InputAdornment, Badge,
} from '@mui/material';
import ExitToAppIcon from '@mui/icons-material/ExitToApp';
import RefreshIcon from '@mui/icons-material/Refresh';
import SearchIcon from '@mui/icons-material/Search';
import TimerIcon from '@mui/icons-material/Timer';
import WarningAmberIcon from '@mui/icons-material/WarningAmber';
import HourglassBottomIcon from '@mui/icons-material/HourglassBottom';
import { agentApi } from '../api/agentApi.js';
import { useAuth } from '../App.jsx';

const PRIORITY_COLORS = { urgent: 'error', medium: 'warning', low: 'default' };
const STATUS_COLORS = {
  new: 'info', open: 'primary', waiting_on_customer: 'warning',
  resolved: 'success', closed: 'default',
};

function formatMinutes(min) {
  if (min === null || min === undefined) return '—';
  const abs = Math.abs(min);
  const sign = min < 0 ? '-' : '';
  if (abs < 60) return `${sign}${Math.round(abs)}m`;
  const h = Math.floor(abs / 60);
  const m = Math.round(abs % 60);
  return `${sign}${h}h${m > 0 ? ` ${m}m` : ''}`;
}

export default function TicketList() {
  const { agent, setAgent } = useAuth();
  const navigate = useNavigate();
  const [tickets, setTickets] = useState([]);
  const [filter, setFilter] = useState('all');
  const [loading, setLoading] = useState(true);
  const [anchorEl, setAnchorEl] = useState(null);

  const fetchTickets = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await agentApi.get(`/agent/tickets?filter=${filter}`);
      setTickets(data.tickets);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, [filter]);

  useEffect(() => { fetchTickets(); }, [fetchTickets]);

  const handleLogout = async () => {
    await agentApi.post('/auth/logout');
    setAgent(null);
    navigate('/login');
  };

  const FILTERS = [
    { key: 'all',         label: 'All Open' },
    { key: 'mine',        label: 'My Tickets' },
    { key: 'unassigned',  label: 'Unassigned' },
    { key: 'late',        label: 'Late' },
    { key: 'waiting',     label: 'Waiting on Customer' },
  ];

  return (
    <Box sx={{ minHeight: '100vh', background: '#0f172a' }}>
      {/* Top AppBar */}
      <AppBar position="sticky" sx={{ background: '#1e293b', borderBottom: '1px solid rgba(99,102,241,0.2)' }}>
        <Toolbar>
          <Typography variant="h6" sx={{ flexGrow: 1, fontWeight: 700, color: '#6366f1' }}>
            🎫 Frontdesk
          </Typography>
          <Typography variant="body2" sx={{ color: '#94a3b8', mr: 2 }}>
            {agent?.name}
          </Typography>
          <IconButton id="refresh-btn" onClick={fetchTickets} sx={{ color: '#94a3b8' }}>
            <RefreshIcon />
          </IconButton>
          <IconButton id="logout-btn" onClick={handleLogout} sx={{ color: '#94a3b8' }}>
            <ExitToAppIcon />
          </IconButton>
        </Toolbar>
      </AppBar>

      <Box sx={{ p: 3, maxWidth: 1400, mx: 'auto' }}>
        {/* Header */}
        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 3 }}>
          <Typography variant="h5" sx={{ color: '#f1f5f9', fontWeight: 700 }}>Support Tickets</Typography>
          <Box sx={{ display: 'flex', gap: 1 }}>
            <Chip icon={<WarningAmberIcon />} label={`${tickets.filter((t) => t.is_late).length} Late`} color="error" size="small" />
            <Chip icon={<HourglassBottomIcon />} label={`${tickets.filter((t) => t.is_waiting).length} Waiting`} color="warning" size="small" />
          </Box>
        </Box>

        {/* Filters */}
        <Box sx={{ display: 'flex', gap: 1, mb: 3, flexWrap: 'wrap' }}>
          {FILTERS.map((f) => (
            <Button
              key={f.key}
              id={`filter-${f.key}`}
              variant={filter === f.key ? 'contained' : 'outlined'}
              size="small"
              onClick={() => setFilter(f.key)}
              sx={{
                borderColor: 'rgba(99,102,241,0.3)',
                color: filter === f.key ? 'white' : '#94a3b8',
                background: filter === f.key ? 'linear-gradient(135deg, #6366f1, #8b5cf6)' : 'transparent',
              }}
            >
              {f.label}
            </Button>
          ))}
        </Box>

        {/* Table */}
        {loading ? (
          <Box sx={{ display: 'flex', justifyContent: 'center', pt: 8 }}>
            <CircularProgress sx={{ color: '#6366f1' }} />
          </Box>
        ) : (
          <TableContainer component={Paper} sx={{ background: '#1e293b', border: '1px solid rgba(99,102,241,0.15)' }}>
            <Table id="tickets-table">
              <TableHead>
                <TableRow sx={{ '& th': { color: '#94a3b8', fontWeight: 600, borderBottom: '1px solid rgba(99,102,241,0.15)' } }}>
                  <TableCell>ID</TableCell>
                  <TableCell>Subject</TableCell>
                  <TableCell>Priority</TableCell>
                  <TableCell>Status</TableCell>
                  <TableCell>Assignee</TableCell>
                  <TableCell>Response Left</TableCell>
                  <TableCell>Resolution Left</TableCell>
                  <TableCell>Badges</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {tickets.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={8} sx={{ textAlign: 'center', color: '#475569', py: 6 }}>
                      No tickets found
                    </TableCell>
                  </TableRow>
                )}
                {tickets.map((ticket) => (
                  <TableRow
                    key={ticket.id}
                    hover
                    id={`ticket-row-${ticket.id}`}
                    onClick={() => navigate(`/tickets/${ticket.id}`)}
                    sx={{
                      cursor: 'pointer',
                      '&:hover': { background: 'rgba(99,102,241,0.08)' },
                      '& td': { borderBottom: '1px solid rgba(99,102,241,0.08)' },
                      background: ticket.is_late ? 'rgba(239,68,68,0.04)' : 'transparent',
                    }}
                  >
                    <TableCell sx={{ color: '#94a3b8', fontSize: 12 }}>#{ticket.id}</TableCell>
                    <TableCell sx={{ color: '#f1f5f9', maxWidth: 300 }}>
                      <Typography variant="body2" noWrap fontWeight={500}>{ticket.subject}</Typography>
                      <Typography variant="caption" sx={{ color: '#475569' }}>{ticket.customer_email}</Typography>
                    </TableCell>
                    <TableCell>
                      <Chip
                        label={ticket.priority}
                        color={PRIORITY_COLORS[ticket.priority]}
                        size="small"
                        id={`priority-chip-${ticket.id}`}
                      />
                    </TableCell>
                    <TableCell>
                      <Chip
                        label={ticket.status.replace('_', ' ')}
                        color={STATUS_COLORS[ticket.status]}
                        size="small"
                        variant="outlined"
                      />
                    </TableCell>
                    <TableCell sx={{ color: '#94a3b8' }}>
                      {ticket.assignee_name ?? <Typography variant="caption" sx={{ color: '#ef4444' }}>Unassigned</Typography>}
                    </TableCell>
                    <TableCell>
                      {ticket.first_response_at ? (
                        <Typography variant="caption" sx={{ color: '#10b981' }}>✓ Sent</Typography>
                      ) : (
                        <Typography variant="caption" sx={{
                          color: ticket.response_late ? '#ef4444' : '#f59e0b',
                          fontWeight: 600,
                        }}>
                          <TimerIcon sx={{ fontSize: 12, mr: 0.5, verticalAlign: 'middle' }} />
                          {formatMinutes(ticket.response_remaining_min)}
                        </Typography>
                      )}
                    </TableCell>
                    <TableCell>
                      <Typography variant="caption" sx={{
                        color: ticket.resolution_late ? '#ef4444' : '#94a3b8',
                        fontWeight: ticket.resolution_late ? 700 : 400,
                      }}>
                        {formatMinutes(ticket.resolution_remaining_min)}
                      </Typography>
                    </TableCell>
                    <TableCell>
                      <Box sx={{ display: 'flex', gap: 0.5 }}>
                        {ticket.is_late && (
                          <Chip label="LATE" color="error" size="small" id={`late-badge-${ticket.id}`} sx={{ fontSize: 10, height: 20 }} />
                        )}
                        {ticket.is_waiting && (
                          <Chip label="WAITING" color="warning" size="small" id={`waiting-badge-${ticket.id}`} sx={{ fontSize: 10, height: 20 }} />
                        )}
                      </Box>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
        )}
      </Box>
    </Box>
  );
}
