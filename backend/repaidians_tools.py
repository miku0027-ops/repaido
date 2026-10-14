"""Compact professional workspace from owned native records, never global scans."""
from fastapi import Depends, Response

import repaidians as social
import repaidians_network as network


def install(core, router, actor):
    @router.get('/professional/workspace')
    def workspace(response: Response, a=Depends(actor)):
        response.headers['Cache-Control'] = 'private, no-store'
        def read(u):
            member = social.professional(u, a)
            uid = member['id']
            profile = social.member_public(u, member)
            career = network.career_profile(u, uid)
            checks = [
                ('photo', 'Add a profile photo', bool(profile.get('avatarUrl')), 'profile'),
                ('headline', 'Describe your work', bool(profile.get('headline')), 'profile'),
                ('city', 'Add your service city', bool(profile.get('city')), 'profile'),
                ('skills', 'Add your skills', bool(profile.get('skills')), 'profile'),
                ('about', 'Introduce yourself', bool(profile.get('bio')), 'profile'),
                ('experience', 'Add your work experience', bool(career.get('experience')), 'background'),
                ('featured', 'Feature your best work', bool(career.get('featured')), 'background'),
                ('publication', 'Publish your first work update',
                 bool(social.visible_count(u, member, 'post', a) + social.visible_count(u, member, 'reel', a)), 'publish'),
            ]
            # The invitation preview is explicitly a bounded recent window.
            refs = social.query(u, social.lane('rp_network_connections', uid), 32)
            u.prefetch([('rp_network_connections', ref['id']) for ref in refs])
            relationships = [u.get('rp_network_connections', ref['id']) for ref in refs]
            network.prefetch_relationships(u, relationships, uid)
            invitations = [row for row in relationships if row and row['recipientId'] == uid
                           and row['status'] == 'pending' and network.live_connection(u, row)]
            members = social.members_for(u, [row['senderId'] for row in invitations[:3]], a)
            allowed = {row['id'] for row in members}
            return {'member': profile,
                    'checklist': [{'id': key, 'label': label, 'complete': complete, 'destination': dest}
                                  for key, label, complete, dest in checks],
                    'completed': sum(bool(row[2]) for row in checks), 'total': len(checks),
                    'stats': {'publications': social.visible_count(u, member, 'post', a)
                              + social.visible_count(u, member, 'reel', a),
                              'connections': (u.get('rp_network_counts', uid) or {}).get('connections', 0),
                              'followers': profile.get('followersCount', 0)},
                    'invitations': [{'id': row['id'], 'memberId': row['senderId'],
                                     'note': row.get('note', ''), 'updatedAt': row.get('updatedAt')}
                                    for row in invitations[:3] if row['senderId'] in allowed],
                    'members': members, 'moreInvitations': len(invitations) > 3 or len(refs) == 32,
                    'serverNow': social.now_ms()}
        return core.operations_store.run(read)
